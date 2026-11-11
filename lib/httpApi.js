'use strict';

/**
 * Client for the REST API of the Toshiba Home AC Control cloud
 * (the same backend the "Toshiba Home AC Control" smartphone app uses).
 */

const BASE_URL = 'https://mobileapi.toshibahomeaccontrols.com';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// the Toshiba cloud firewall rejects bursts of requests, keep them well apart
const MIN_REQUEST_INTERVAL_MS = 1000;
const REQUEST_JITTER_MS = 500;
const REQUEST_TIMEOUT_MS = 20000;

class ToshibaApiError extends Error {}
class ToshibaAuthError extends ToshibaApiError {}
class ToshibaRateLimitError extends ToshibaApiError {}

class ToshibaHttpApi {
    /**
     * @param {string} username
     * @param {string} password
     * @param {{debug: Function}} [log]
     * @param {string} [deviceId] stable id of this installation, sent as "Device-ID" header.
     *        Required by the Toshiba cloud firewall since mid 2026, otherwise it answers HTTP 429.
     */
    constructor(username, password, log, deviceId) {
        this.username = username;
        this.password = password;
        this.deviceId = deviceId;
        this.log = log || { debug: () => {} };
        this.accessToken = null;
        this.tokenType = null;
        this.consumerId = null;
        this._queue = Promise.resolve();
        this._lastRequest = 0;
    }

    /** Serialises requests and keeps a minimum distance between them. */
    _paced(fn) {
        const run = this._queue.then(async () => {
            const wait = this._lastRequest + MIN_REQUEST_INTERVAL_MS + Math.random() * REQUEST_JITTER_MS - Date.now();
            if (wait > 0) {
                await new Promise(r => setTimeout(r, wait));
            }
            try {
                return await fn();
            } finally {
                this._lastRequest = Date.now();
            }
        });
        this._queue = run.catch(() => {});
        return run;
    }

    async _rawRequest(path, { query, body, auth = true } = {}) {
        const url = new URL(BASE_URL + path);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                url.searchParams.set(k, v);
            }
        }
        const headers = { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT };
        if (this.deviceId) {
            headers['Device-ID'] = this.deviceId;
        }
        if (auth) {
            if (!this.accessToken) {
                throw new ToshibaApiError('Not logged in');
            }
            headers.Authorization = `${this.tokenType} ${this.accessToken}`;
        }
        this.log.debug(`${body ? 'POST' : 'GET'} ${path}`);
        const res = await this._paced(() =>
            fetch(url, {
                method: body ? 'POST' : 'GET',
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            }),
        );

        if (res.status === 200) {
            let json;
            try {
                json = await res.json();
            } catch (e) {
                throw new ToshibaApiError(`Malformed JSON response for ${path}: ${e.message}`);
            }
            if (json.IsSuccess) {
                return json.ResObj;
            }
            if (json.StatusCode === 'InvalidUserNameorPassword') {
                throw new ToshibaAuthError(json.Message || 'Invalid username or password');
            }
            throw new ToshibaApiError(json.Message || `Request ${path} failed (${json.StatusCode})`);
        }
        if (res.status === 401) {
            throw new ToshibaAuthError(`HTTP 401 calling ${path}`);
        }
        if (res.status === 403 || res.status === 429) {
            const retryAfter = parseInt(res.headers && res.headers.get ? res.headers.get('retry-after') : '', 10);
            const err = new ToshibaRateLimitError(`HTTP ${res.status} calling ${path} (rate limited by Toshiba cloud)`);
            err.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined;
            throw err;
        }
        throw new ToshibaApiError(`HTTP ${res.status} calling ${path}`);
    }

    /** Authenticated request with one automatic re-login on 401. */
    async request(path, opts = {}) {
        try {
            return await this._rawRequest(path, opts);
        } catch (e) {
            if (e instanceof ToshibaAuthError && opts.auth !== false && !opts._retried) {
                this.log.debug(`Auth error on ${path}, logging in again`);
                await this.login();
                return this._rawRequest(path, { ...opts, _retried: true });
            }
            throw e;
        }
    }

    async login() {
        const res = await this._rawRequest('/api/Consumer/Login', {
            body: { Username: this.username, Password: this.password },
            auth: false,
        });
        if (!res || !res.access_token) {
            throw new ToshibaApiError('Login response does not contain an access token');
        }
        this.accessToken = res.access_token;
        this.tokenType = res.token_type || 'Bearer';
        this.consumerId = res.consumerId;
        return res;
    }

    /**
     * Registers this adapter as "mobile device" and returns the SAS token for Azure IoT Hub.
     *
     * @param {string} deviceId
     */
    async registerClient(deviceId) {
        const res = await this.request('/api/Consumer/RegisterMobileDevice', {
            body: { DeviceID: deviceId, DeviceType: '1', Username: this.username },
        });
        if (!res || typeof res.SasToken !== 'string') {
            throw new ToshibaApiError('Missing SasToken in response');
        }
        return res.SasToken;
    }

    /** @returns {Promise<Array<object>>} list of indoor units */
    async getDevices() {
        const res = await this.request('/api/AC/GetConsumerACMapping', { query: { consumerId: this.consumerId } });
        const devices = [];
        for (const group of res || []) {
            for (const ac of group.ACList || []) {
                devices.push({
                    acId: ac.Id,
                    uniqueId: ac.DeviceUniqueId,
                    name: ac.Name,
                    state: ac.ACStateData,
                    firmware: ac.FirmwareVersion,
                    meritFeature: ac.MeritFeature,
                    modelId: ac.ACModelId,
                    groupName: group.GroupName,
                });
            }
        }
        return devices;
    }

    /** @param {string} acId */
    async getDeviceState(acId) {
        const query = { ACId: acId };
        if (this.consumerId) {
            query.consumerId = this.consumerId;
        }
        const res = await this.request('/api/AC/GetCurrentACState', { query });
        if (!res || typeof res.ACStateData !== 'string') {
            throw new ToshibaApiError('Missing ACStateData in response');
        }
        return {
            state: res.ACStateData,
            fcuModel: (res.Fcu && res.Fcu.model_name) || null,
            cduModel: (res.Cdu && res.Cdu.model_name) || null,
        };
    }

    /**
     * Energy consumption of the current year in Wh per device unique id.
     *
     * @param {string[]} uniqueIds
     */
    async getEnergyConsumption(uniqueIds) {
        const year = new Date().getFullYear();
        const res = await this.request('/api/AC/GetGroupACEnergyConsumption', {
            body: {
                ACDeviceUniqueIdList: uniqueIds,
                FromUtcTime: String(year),
                Timezone: 'UTC',
                ToUtcTime: String(year + 1),
                Type: 'EnergyYear',
            },
        });
        const result = {};
        for (const ac of Array.isArray(res) ? res : []) {
            if (!ac || !Array.isArray(ac.EnergyConsumption)) {
                continue;
            }
            const sum = ac.EnergyConsumption.reduce((acc, e) => acc + (parseInt(e.Energy, 10) || 0), 0);
            result[ac.ACDeviceUniqueId] = sum;
        }
        return result;
    }
}

module.exports = { ToshibaHttpApi, ToshibaApiError, ToshibaAuthError, ToshibaRateLimitError };
