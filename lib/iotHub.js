'use strict';

/**
 * Real-time connection to the Toshiba Azure IoT Hub.
 *
 * The adapter registers itself like a smartphone app. State changes of the indoor
 * units are pushed by the cloud as direct method "smmobile" calls, commands are sent
 * as device-to-cloud messages.
 */

const { EventEmitter } = require('node:events');
const { Client, Message } = require('azure-iot-device');
const { Mqtt, MqttWs } = require('azure-iot-device-mqtt');

class ToshibaIotHub extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.deviceId           client id ("<username>_<random>")
     * @param {() => Promise<string>} opts.getSasToken   callback returning a fresh SAS token
     * @param {boolean} [opts.useWebsocket]    use MQTT over websockets (port 443)
     * @param {object} opts.log
     */
    constructor(opts) {
        super();
        this.deviceId = opts.deviceId;
        this.getSasToken = opts.getSasToken;
        this.useWebsocket = !!opts.useWebsocket;
        this.log = opts.log;
        this.client = null;
        this.connected = false;
        this._renewTimer = null;
        this._reconnectTimer = null;
        this._stopped = false;
    }

    async connect() {
        this._stopped = false;
        const sas = await this.getSasToken();
        this._createClient(sas);
        await this.client.open();
        this._setConnected(true);
        this._scheduleRenew(sas);
    }

    _createClient(sas) {
        this.client = Client.fromSharedAccessSignature(sas, this.useWebsocket ? MqttWs : Mqtt);
        this.client.on('error', err => {
            this.log.warn(`IoT Hub error: ${err && err.message}`);
        });
        this.client.on('disconnect', () => {
            this._setConnected(false);
            if (!this._stopped) {
                this.log.warn('IoT Hub connection lost, reconnecting in 30 s');
                this._scheduleReconnect(30000);
            }
        });
        this.client.onDeviceMethod('smmobile', (request, response) => this._onMethod(request, response));
    }

    async _onMethod(request, response) {
        try {
            let payload = request.payload;
            if (Buffer.isBuffer(payload)) {
                payload = payload.toString('utf8');
            }
            if (typeof payload === 'string') {
                payload = JSON.parse(payload);
            }
            if (payload && typeof payload === 'object' && typeof payload.cmd === 'string') {
                this.emit('command', payload);
            } else {
                this.log.debug(`Ignoring malformed method payload: ${JSON.stringify(request.payload)}`);
            }
        } catch (e) {
            this.log.warn(`Cannot process message from IoT Hub: ${e.message}`);
        } finally {
            try {
                await response.send(0);
            } catch (e) {
                this.log.debug(`Failed to acknowledge method call: ${e.message}`);
            }
        }
    }

    _setConnected(state) {
        if (this.connected !== state) {
            this.connected = state;
            this.emit('connection', state);
        }
    }

    _scheduleReconnect(delay) {
        if (this._reconnectTimer || this._stopped) {
            return;
        }
        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            try {
                await this._closeClient();
                await this.connect();
                this.log.info('IoT Hub reconnected');
                this.emit('reconnected');
            } catch (e) {
                this.log.warn(`IoT Hub reconnect failed: ${e.message}`);
                this._scheduleReconnect(Math.min(delay * 2, 10 * 60000));
            }
        }, delay);
    }

    /** Renews the SAS token shortly before it expires. */
    _scheduleRenew(sas) {
        clearTimeout(this._renewTimer);
        const match = /[?&\s]se=(\d+)/.exec(` ${sas}`);
        let delay = 12 * 3600 * 1000;
        if (match) {
            const expiresAt = parseInt(match[1], 10) * 1000;
            delay = Math.max(60000, expiresAt - Date.now() - 10 * 60000);
        }
        // setTimeout supports max ~24.8 days
        delay = Math.min(delay, 0x7fffffff);
        this.log.debug(`SAS token renewal scheduled in ${Math.round(delay / 60000)} min`);
        this._renewTimer = setTimeout(async () => {
            try {
                const newSas = await this.getSasToken();
                await new Promise((resolve, reject) =>
                    this.client.updateSharedAccessSignature(newSas, err => (err ? reject(err) : resolve())),
                );
                this.log.debug('SAS token renewed');
                this._scheduleRenew(newSas);
            } catch (e) {
                this.log.warn(`SAS token renewal failed: ${e.message}`);
                this._scheduleReconnect(60000);
            }
        }, delay);
    }

    /**
     * Sends a new (partial) state to an indoor unit.
     *
     * @param {string} acUniqueId
     * @param {string} hexState
     */
    async sendState(acUniqueId, hexState) {
        if (!this.client || !this.connected) {
            throw new Error('Not connected to IoT Hub');
        }
        const body = {
            sourceId: this.deviceId,
            messageId: '0000000',
            targetId: [acUniqueId],
            cmd: 'CMD_FCU_TO_AC',
            payload: { data: hexState },
            timeStamp: '0000000',
        };
        const msg = new Message(JSON.stringify(body));
        msg.properties.add('type', 'mob');
        msg.contentType = 'application/json';
        msg.contentEncoding = 'utf-8';
        await this.client.sendEvent(msg);
    }

    async _closeClient() {
        if (this.client) {
            const c = this.client;
            this.client = null;
            c.removeAllListeners();
            c.on('error', () => {});
            try {
                await c.close();
            } catch {
                // ignore
            }
        }
    }

    async disconnect() {
        this._stopped = true;
        clearTimeout(this._renewTimer);
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        await this._closeClient();
        this._setConnected(false);
    }
}

module.exports = { ToshibaIotHub };
