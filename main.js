'use strict';

/*
 * ioBroker adapter for Toshiba air conditioners connected to the
 * "Toshiba Home AC Control" cloud (Wi-Fi adapters RB-N101S-G, RB-N106S-G,
 * built-in Wi-Fi of Shorai Edge, Seiya, Daiseikai, Haori, ...).
 */

const utils = require('@iobroker/adapter-core');
const crypto = require('node:crypto');
const { ToshibaHttpApi, ToshibaAuthError, ToshibaRateLimitError } = require('./lib/httpApi');
const { ToshibaIotHub } = require('./lib/iotHub');
const { FcuState } = require('./lib/fcuState');
const { getFeatures, meritAAllowedInMode, meritBAllowedInMode } = require('./lib/features');

const LABELS = {
    mode: { AUTO: 'Auto', COOL: 'Cool', HEAT: 'Heat', DRY: 'Dry', FAN: 'Fan only' },
    fanMode: {
        AUTO: 'Auto',
        QUIET: 'Quiet',
        LOW: 'Low (1)',
        MEDIUM_LOW: 'Medium low (2)',
        MEDIUM: 'Medium (3)',
        MEDIUM_HIGH: 'Medium high (4)',
        HIGH: 'High (5)',
    },
    swingMode: {
        OFF: 'Off',
        SWING_VERTICAL: 'Swing vertical',
        SWING_HORIZONTAL: 'Swing horizontal',
        SWING_VERTICAL_AND_HORIZONTAL: 'Swing vertical + horizontal',
        FIXED_1: 'Fixed position 1',
        FIXED_2: 'Fixed position 2',
        FIXED_3: 'Fixed position 3',
        FIXED_4: 'Fixed position 4',
        FIXED_5: 'Fixed position 5',
    },
    powerSelection: { POWER_50: '50 %', POWER_75: '75 %', POWER_100: '100 %' },
    meritA: {
        OFF: 'Off',
        HIGH_POWER: 'Hi-Power',
        ECO: 'Eco',
        CDU_SILENT_1: 'Outdoor unit silent 1',
        CDU_SILENT_2: 'Outdoor unit silent 2',
        HEATING_8C: '8 °C frost protection',
        SLEEP_CARE: 'Sleep care',
        FLOOR: 'Floor',
        COMFORT: 'Comfort',
    },
    meritB: { OFF: 'Off', FIREPLACE_1: 'Fireplace 1', FIREPLACE_2: 'Fireplace 2' },
};

/** Writable select-type states: state id -> FcuState field and feature list */
const SELECT_STATES = {
    mode: { field: 'mode', feature: 'modes', name: { en: 'Operating mode', de: 'Betriebsart' } },
    fanMode: { field: 'fanMode', feature: 'fanModes', name: { en: 'Fan speed', de: 'Lüfterstufe' } },
    swingMode: { field: 'swingMode', feature: 'swingModes', name: { en: 'Louver / swing', de: 'Lamellen / Swing' } },
    powerSelection: {
        field: 'powerSelection',
        feature: 'powerSelections',
        name: { en: 'Power limit', de: 'Leistungsbegrenzung' },
    },
    meritA: {
        field: 'meritA',
        feature: 'meritA',
        name: { en: 'Special mode (Eco, Hi-Power, 8 °C, ...)', de: 'Sonderfunktion (Eco, Hi-Power, 8 °C, ...)' },
    },
    meritB: { field: 'meritB', feature: 'meritB', name: { en: 'Fireplace mode', de: 'Kaminmodus' } },
};

const CONFIRM_TIMEOUT_MS = 15000;

class ToshibaAc extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'toshiba-ac' });
        /** @type {Map<string, any>} uniqueId -> device */
        this.devices = new Map();
        /** @type {Map<string, string>} object id prefix -> uniqueId */
        this.idToUnique = new Map();
        this.http = null;
        this.iot = null;
        this.pollTimer = null;
        this.energyTimer = null;
        this.startTimer = null;
        this.startDelay = 60000;
        this.unloading = false;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync('info.connection', false, true);

        if (!this.config.username || !this.config.password) {
            this.log.error('Please enter user name and password of your Toshiba Home AC Control account in the adapter settings.');
            return;
        }

        this.subscribeStates('*');
        await this.start();
    }

    async start() {
        if (this.unloading) {
            return;
        }
        try {
            await this.initialize();
            this.startDelay = 60000;
        } catch (e) {
            await this.stopConnections();
            if (e instanceof ToshibaAuthError) {
                this.log.error(`Login failed: ${e.message}. Please check user name and password.`);
                return;
            }
            // never hammer the cloud after a rate limit answer, otherwise the block gets longer
            const delay =
                e instanceof ToshibaRateLimitError
                    ? Math.max(this.startDelay, 10 * 60000, e.retryAfterMs || 0)
                    : this.startDelay;
            this.log.warn(`Initialisation failed: ${e.message}. Retrying in ${Math.round(delay / 1000)} s`);
            this.startTimer = this.setTimeout(() => {
                this.startTimer = null;
                this.start();
            }, delay);
            this.startDelay = Math.min(this.startDelay * 2, 30 * 60000);
        }
    }

    async initialize() {
        const clientId = await this.getClientId();
        const deviceId = `${this.config.username}_${clientId}`;

        this.http = new ToshibaHttpApi(this.config.username, this.config.password, this.log, clientId);
        await this.http.login();
        this.log.info('Logged in to Toshiba Home AC Control cloud');

        const acs = await this.http.getDevices();
        if (!acs.length) {
            this.log.warn('No air conditioners found in your Toshiba account');
        }
        for (const ac of acs) {
            await this.setupDevice(ac);
        }

        this.iot = new ToshibaIotHub({
            deviceId,
            useWebsocket: !!this.config.useWebsocket,
            log: this.log,
            getSasToken: () => this.http.registerClient(deviceId),
        });
        this.iot.on('command', msg => this.onCloudCommand(msg).catch(e => this.log.warn(`Error handling message: ${e.message}`)));
        this.iot.on('connection', connected => this.setState('info.connection', connected, true));
        this.iot.on('reconnected', () => this.pollAll());
        await this.iot.connect();
        this.log.info(`Connected to Toshiba IoT Hub, ${acs.length} indoor unit(s) found`);

        // fetch model names and fresh state
        await this.pollAll(true);

        const pollMinutes = Math.max(1, Number(this.config.pollInterval) || 10);
        this.pollTimer = this.setInterval(() => this.pollAll(), pollMinutes * 60000);

        if ([...this.devices.values()].some(d => d.features.energyReport)) {
            const energyMinutes = Math.max(5, Number(this.config.energyInterval) || 30);
            await this.updateEnergy();
            this.energyTimer = this.setInterval(() => this.updateEnergy(), energyMinutes * 60000);
        }
    }

    /** Stable random id of this adapter instance used to register at the cloud. */
    async getClientId() {
        const state = await this.getStateAsync('info.clientId');
        if (state && typeof state.val === 'string' && /^[0-9a-f]{16}$/.test(state.val)) {
            return state.val;
        }
        const id = crypto.randomBytes(8).toString('hex');
        await this.setStateAsync('info.clientId', id, true);
        return id;
    }

    makeDeviceId(ac) {
        let base = String(ac.name || ac.uniqueId)
            .replace(this.FORBIDDEN_CHARS, '_')
            .replace(/[.\s]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!base) {
            base = String(ac.uniqueId).replace(this.FORBIDDEN_CHARS, '_').replace(/\./g, '_');
        }
        if (this.idToUnique.has(base) && this.idToUnique.get(base) !== ac.uniqueId) {
            base = `${base}_${String(ac.uniqueId).replace(/[^0-9a-zA-Z]/g, '').slice(0, 8)}`;
        }
        return base;
    }

    async setupDevice(ac) {
        const id = this.makeDeviceId(ac);
        const features = getFeatures(ac.meritFeature, ac.modelId);
        let fcu;
        try {
            fcu = FcuState.fromHex(ac.state || '');
        } catch (e) {
            this.log.warn(`${ac.name}: cannot decode initial state "${ac.state}": ${e.message}`);
            fcu = new FcuState();
        }
        const device = { ...ac, id, features, fcu, confirmTimer: null };
        this.devices.set(ac.uniqueId, device);
        this.idToUnique.set(id, ac.uniqueId);
        this.log.debug(`${ac.name}: model ${ac.modelId}, merit ${ac.meritFeature}, features ${JSON.stringify(features)}`);

        await this.extendObjectAsync(id, {
            type: 'device',
            common: { name: ac.name, statusStates: { onlineId: `${this.namespace}.info.connection` } },
            native: { acId: ac.acId, uniqueId: ac.uniqueId },
        });
        await this.extendObjectAsync(`${id}.info`, {
            type: 'channel',
            common: { name: { en: 'Device information', de: 'Geräteinformationen' } },
            native: {},
        });

        const info = {
            name: [{ en: 'Name', de: 'Name' }, ac.name],
            acId: [{ en: 'AC id', de: 'AC-ID' }, ac.acId],
            uniqueId: [{ en: 'Unique device id', de: 'Eindeutige Geräte-ID' }, ac.uniqueId],
            firmware: [{ en: 'Firmware version', de: 'Firmware-Version' }, ac.firmware],
            modelId: [{ en: 'Model id', de: 'Modell-ID' }, ac.modelId],
            meritFeature: [{ en: 'Feature flags', de: 'Funktions-Flags' }, ac.meritFeature],
            group: [{ en: 'Group in app', de: 'Gruppe in der App' }, ac.groupName],
        };
        for (const [key, [name, val]] of Object.entries(info)) {
            await this.createState(`${id}.info.${key}`, { name, type: 'string', role: 'text', read: true, write: false });
            await this.setStateAsync(`${id}.info.${key}`, val === undefined || val === null ? '' : String(val), true);
        }
        await this.createState(`${id}.info.indoorUnitModel`, {
            name: { en: 'Indoor unit model', de: 'Modell Innengerät' },
            type: 'string',
            role: 'text',
            read: true,
            write: false,
        });
        await this.createState(`${id}.info.outdoorUnitModel`, {
            name: { en: 'Outdoor unit model', de: 'Modell Außengerät' },
            type: 'string',
            role: 'text',
            read: true,
            write: false,
        });
        await this.createState(`${id}.info.rawState`, {
            name: { en: 'Raw state (hex)', de: 'Rohzustand (hex)' },
            type: 'string',
            role: 'text',
            read: true,
            write: false,
        });
        await this.createState(`${id}.info.lastUpdate`, {
            name: { en: 'Last update', de: 'Letzte Aktualisierung' },
            type: 'number',
            role: 'value.time',
            read: true,
            write: false,
        });

        await this.createState(`${id}.power`, {
            name: { en: 'Power', de: 'Ein/Aus' },
            type: 'boolean',
            role: 'switch.power',
            read: true,
            write: true,
        });
        await this.createState(`${id}.targetTemperature`, {
            name: { en: 'Target temperature', de: 'Solltemperatur' },
            type: 'number',
            role: 'level.temperature',
            unit: '°C',
            min: 5,
            max: 30,
            step: 1,
            read: true,
            write: true,
        });
        await this.createState(`${id}.indoorTemperature`, {
            name: { en: 'Indoor temperature', de: 'Raumtemperatur' },
            type: 'number',
            role: 'value.temperature',
            unit: '°C',
            read: true,
            write: false,
        });
        await this.createState(`${id}.outdoorTemperature`, {
            name: { en: 'Outdoor temperature', de: 'Außentemperatur' },
            type: 'number',
            role: 'value.temperature',
            unit: '°C',
            read: true,
            write: false,
        });
        for (const [key, def] of Object.entries(SELECT_STATES)) {
            const values = features[def.feature];
            if (key === 'meritB' && values.length <= 1) {
                await this.delObjectAsync(`${id}.${key}`).catch(() => {});
                continue;
            }
            const states = {};
            for (const v of values) {
                states[v] = LABELS[def.field][v] || v;
            }
            await this.createState(`${id}.${key}`, {
                name: def.name,
                type: 'string',
                role: key === 'mode' ? 'level.mode.thermostat' : 'text',
                states,
                read: true,
                write: true,
            });
        }
        if (features.airPureIon) {
            await this.createState(`${id}.airPureIon`, {
                name: { en: 'Air purifier (Plasma ion)', de: 'Luftreinigung (Plasma-Ionisator)' },
                type: 'boolean',
                role: 'switch',
                read: true,
                write: true,
            });
        }
        await this.createState(`${id}.selfCleaning`, {
            name: { en: 'Self cleaning active', de: 'Selbstreinigung aktiv' },
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
        });
        if (features.energyReport) {
            await this.createState(`${id}.energyConsumptionYear`, {
                name: { en: 'Energy consumption (current year)', de: 'Energieverbrauch (aktuelles Jahr)' },
                type: 'number',
                role: 'value.energy.consumed',
                unit: 'Wh',
                read: true,
                write: false,
            });
        }

        await this.updateStates(device, ac.state);
    }

    async createState(id, common) {
        await this.extendObjectAsync(id, { type: 'state', common, native: {} });
    }

    /** Writes the current FCU state of a device to the ioBroker states. */
    async updateStates(device, rawHex, force = false) {
        const s = device.fcu;
        const id = device.id;
        const set = async (key, val) => {
            if (val === null || val === undefined) {
                return;
            }
            if (force) {
                await this.setStateAsync(`${id}.${key}`, val, true);
            } else {
                await this.setStateChangedAsync(`${id}.${key}`, val, true);
            }
        };

        const status = s.get('status');
        await set('power', status === null ? null : status === 'ON');

        let target = s.get('temperature');
        if (target !== null && s.get('mode') === 'HEAT' && s.get('meritA') === 'HEATING_8C') {
            target -= 16;
        }
        await set('targetTemperature', target);
        await set('indoorTemperature', s.get('indoorTemperature'));
        await set('outdoorTemperature', s.get('outdoorTemperature'));
        for (const [key, def] of Object.entries(SELECT_STATES)) {
            if (key === 'meritB' && device.features.meritB.length <= 1) {
                continue;
            }
            await set(key, s.get(def.field));
        }
        if (device.features.airPureIon) {
            const ion = s.get('airPureIon');
            await set('airPureIon', ion === null ? null : ion === 'ON');
        }
        const clean = s.get('selfCleaning');
        await set('selfCleaning', clean === null ? null : clean === 'ON');
        await this.setStateAsync(`${id}.info.rawState`, s.encode(), true);
        if (rawHex) {
            this.log.debug(`${device.name}: received state ${rawHex}`);
        }
        await this.setStateAsync(`${id}.info.lastUpdate`, Date.now(), true);
    }

    /** Messages pushed by the cloud via IoT Hub. */
    async onCloudCommand(msg) {
        const device = this.devices.get(msg.sourceId);
        if (!device) {
            this.log.debug(`Message ${msg.cmd} for unknown device ${msg.sourceId}`);
            return;
        }
        const payload = msg.payload || {};
        if (msg.cmd === 'CMD_FCU_FROM_AC') {
            if (typeof payload.data !== 'string') {
                return;
            }
            this.clearConfirmTimer(device);
            device.fcu.merge(FcuState.fromHex(payload.data));
            // force: confirms (ack) pending user commands even if the value did not change
            await this.updateStates(device, payload.data, true);
        } else if (msg.cmd === 'CMD_HEARTBEAT') {
            this.log.debug(`${device.name}: heartbeat ${JSON.stringify(payload)}`);
            const parse = v => {
                const n = parseInt(String(v), 16);
                if (Number.isNaN(n)) {
                    return null;
                }
                return n > 127 ? n - 256 : n;
            };
            if (payload.iTemp !== undefined) {
                const t = parse(payload.iTemp);
                if (t !== null && t !== 127 && t !== -128) {
                    device.fcu.set('indoorTemperature', t);
                }
            }
            if (payload.oTemp !== undefined) {
                const t = parse(payload.oTemp);
                if (t !== null && t !== 127 && t !== -128) {
                    device.fcu.set('outdoorTemperature', t);
                }
            }
            for (const key of ['indoorTemperature', 'outdoorTemperature']) {
                const val = device.fcu.get(key);
                if (val !== null) {
                    await this.setStateChangedAsync(`${device.id}.${key}`, val, true);
                }
            }
        } else {
            this.log.debug(`${device.name}: unhandled command ${msg.cmd}: ${JSON.stringify(payload)}`);
        }
    }

    async pollDevice(device, withModels = false, force = false) {
        const res = await this.http.getDeviceState(device.acId);
        device.fcu.merge(FcuState.fromHex(res.state));
        await this.updateStates(device, res.state, force);
        if (withModels) {
            await this.setStateAsync(`${device.id}.info.indoorUnitModel`, res.fcuModel || '', true);
            await this.setStateAsync(`${device.id}.info.outdoorUnitModel`, res.cduModel || '', true);
        }
    }

    async pollAll(withModels = false) {
        for (const device of this.devices.values()) {
            try {
                await this.pollDevice(device, withModels);
            } catch (e) {
                this.log.warn(`${device.name}: state update failed: ${e.message}`);
                if (e instanceof ToshibaRateLimitError) {
                    return;
                }
            }
        }
    }

    async updateEnergy() {
        const ids = [...this.devices.values()].filter(d => d.features.energyReport).map(d => d.uniqueId);
        if (!ids.length) {
            return;
        }
        try {
            const energy = await this.http.getEnergyConsumption(ids);
            for (const [uniqueId, wh] of Object.entries(energy)) {
                const device = this.devices.get(uniqueId);
                if (device) {
                    await this.setStateChangedAsync(`${device.id}.energyConsumptionYear`, wh, true);
                }
            }
        } catch (e) {
            this.log.warn(`Energy consumption update failed: ${e.message}`);
        }
    }

    clearConfirmTimer(device) {
        if (device.confirmTimer) {
            this.clearTimeout(device.confirmTimer);
            device.confirmTimer = null;
        }
    }

    /**
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const parts = id.split('.');
        const key = parts.pop();
        const devId = parts.slice(2).join('.');
        const uniqueId = this.idToUnique.get(devId);
        const device = uniqueId && this.devices.get(uniqueId);
        if (!device) {
            return;
        }
        try {
            const cmd = this.buildCommand(device, key, state.val);
            if (!cmd) {
                return;
            }
            const hex = cmd.encode();
            this.log.debug(`${device.name}: sending ${key}=${state.val} (${hex})`);
            await this.iot.sendState(device.uniqueId, hex);
            // if the unit does not confirm the change, re-read the real state
            this.clearConfirmTimer(device);
            device.confirmTimer = this.setTimeout(() => {
                device.confirmTimer = null;
                this.pollDevice(device, false, true).catch(e => this.log.debug(`${device.name}: refresh failed: ${e.message}`));
            }, CONFIRM_TIMEOUT_MS);
        } catch (e) {
            this.log.warn(`${device.name}: cannot set ${key} to ${state.val}: ${e.message}`);
            // restore the real value
            await this.updateStates(device, null, true).catch(() => {});
        }
    }

    /**
     * Builds a partial FCU state for a single changed ioBroker state.
     *
     * @returns {FcuState | null}
     */
    buildCommand(device, key, val) {
        const cur = device.fcu;
        const f = device.features;
        const cmd = new FcuState();
        const currentMode = cur.get('mode');

        switch (key) {
            case 'power': {
                const on = val === true || val === 'true' || val === 1 || val === '1' || val === 'ON';
                cmd.set('status', on ? 'ON' : 'OFF');
                // switching on during self cleaning requires to stop the cleaning
                if (on && cur.get('selfCleaning') === 'ON') {
                    cmd.set('selfCleaning', 'OFF');
                }
                break;
            }
            case 'targetTemperature': {
                let t = Math.round(Number(val));
                if (!Number.isFinite(t)) {
                    throw new Error('not a number');
                }
                const frostMode = currentMode === 'HEAT' && cur.get('meritA') === 'HEATING_8C';
                const [min, max] = frostMode ? [5, 13] : [17, 30];
                if (t < min || t > max) {
                    throw new Error(`temperature must be between ${min} and ${max} °C in the current mode`);
                }
                if (frostMode) {
                    t += 16;
                }
                cmd.set('temperature', t);
                break;
            }
            case 'airPureIon': {
                if (!f.airPureIon) {
                    throw new Error('not supported by this unit');
                }
                const on = val === true || val === 'true' || val === 1 || val === '1' || val === 'ON';
                cmd.set('airPureIon', on ? 'ON' : 'OFF');
                break;
            }
            default: {
                const def = SELECT_STATES[key];
                if (!def) {
                    return null;
                }
                const v = String(val).toUpperCase();
                if (!f[def.feature].includes(v)) {
                    throw new Error(`value not supported, allowed: ${f[def.feature].join(', ')}`);
                }
                if (key === 'meritA' && currentMode && !meritAAllowedInMode(v, currentMode)) {
                    throw new Error(`not available in mode ${currentMode}`);
                }
                if (key === 'meritB' && currentMode && !meritBAllowedInMode(v, currentMode)) {
                    throw new Error(`not available in mode ${currentMode}`);
                }
                cmd.set(def.field, v);
            }
        }
        return cmd;
    }

    async stopConnections() {
        if (this.pollTimer) {
            this.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.energyTimer) {
            this.clearInterval(this.energyTimer);
            this.energyTimer = null;
        }
        for (const d of this.devices.values()) {
            this.clearConfirmTimer(d);
        }
        if (this.iot) {
            const iot = this.iot;
            this.iot = null;
            await iot.disconnect();
        }
    }

    /**
     * @param {() => void} callback
     */
    async onUnload(callback) {
        this.unloading = true;
        try {
            if (this.startTimer) {
                this.clearTimeout(this.startTimer);
            }
            await this.stopConnections();
            await this.setStateAsync('info.connection', false, true);
        } catch {
            // ignore
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new ToshibaAc(options);
} else {
    new ToshibaAc();
}
