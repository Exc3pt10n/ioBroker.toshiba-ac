'use strict';

/* Smoke test of the adapter logic with a minimal fake of @iobroker/adapter-core */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

class FakeAdapter extends EventEmitter {
    constructor(opts) {
        super();
        this.name = opts.name;
        this.namespace = `${opts.name}.0`;
        this.FORBIDDEN_CHARS = /[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu;
        this.config = {};
        this.objects = {};
        this.states = {};
        const noop = () => {};
        this.log = { debug: noop, info: noop, warn: noop, error: noop };
    }
    async extendObjectAsync(id, obj) {
        this.objects[id] = { ...(this.objects[id] || {}), ...obj };
    }
    async delObjectAsync(id) {
        if (!this.objects[id]) {
            throw new Error('not found');
        }
        delete this.objects[id];
    }
    async setStateAsync(id, val, ack) {
        this.states[id] = { val, ack };
    }
    async setStateChangedAsync(id, val, ack) {
        if (!this.states[id] || this.states[id].val !== val) {
            this.states[id] = { val, ack };
        }
    }
    setState(id, val, ack) {
        this.states[id] = { val, ack };
    }
    async getStateAsync(id) {
        return this.states[id] || null;
    }
    setTimeout(fn, ms) {
        return setTimeout(fn, ms);
    }
    clearTimeout(t) {
        clearTimeout(t);
    }
    setInterval(fn, ms) {
        return setInterval(fn, ms);
    }
    clearInterval(t) {
        clearInterval(t);
    }
    subscribeStates() {}
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === '@iobroker/adapter-core') {
        return { Adapter: FakeAdapter };
    }
    return origLoad.call(this, request, ...rest);
};
const createAdapter = require('../main.js');
Module._load = origLoad;

async function setup() {
    const adapter = createAdapter();
    const sent = [];
    adapter.iot = { sendState: async (id, hex) => sent.push({ id, hex }) };
    await adapter.setupDevice({
        acId: 'a1',
        uniqueId: 'u-1',
        name: 'Wohnzimmer',
        state: '30421641416400101 60b0000100210020100 00'.replace(/ /g, ''),
        meritFeature: '0b00',
        modelId: '2',
    });
    return { adapter, sent };
}

test('creates objects and initial states', async () => {
    const { adapter } = await setup();
    assert.equal(adapter.objects.Wohnzimmer.type, 'device');
    assert.equal(adapter.states['Wohnzimmer.power'].val, true);
    assert.equal(adapter.states['Wohnzimmer.mode'].val, 'COOL');
    assert.equal(adapter.states['Wohnzimmer.targetTemperature'].val, 22);
    assert.equal(adapter.states['Wohnzimmer.outdoorTemperature'].val, 11);
    assert.ok(adapter.objects['Wohnzimmer.mode'].common.states.HEAT);
});

test('user command is encoded and sent', async () => {
    const { adapter, sent } = await setup();
    await adapter.onStateChange('toshiba-ac.0.Wohnzimmer.targetTemperature', { val: 24, ack: false });
    await adapter.onStateChange('toshiba-ac.0.Wohnzimmer.power', { val: false, ack: false });
    await adapter.onStateChange('toshiba-ac.0.Wohnzimmer.mode', { val: 'HEAT', ack: false });
    assert.deepEqual(
        sent.map(s => s.hex),
        [`ffff18${'f'.repeat(32)}`, `31${'f'.repeat(36)}`, `ff43${'f'.repeat(34)}`],
    );
    assert.equal(sent[0].id, 'u-1');
    for (const d of adapter.devices.values()) {
        adapter.clearConfirmTimer(d);
    }
});

test('invalid command is rejected and state restored', async () => {
    const { adapter, sent } = await setup();
    adapter.states['Wohnzimmer.targetTemperature'] = { val: 40, ack: false };
    await adapter.onStateChange('toshiba-ac.0.Wohnzimmer.targetTemperature', { val: 40, ack: false });
    assert.equal(sent.length, 0);
    assert.deepEqual(adapter.states['Wohnzimmer.targetTemperature'], { val: 22, ack: true });
});

test('push update from cloud updates states', async () => {
    const { adapter } = await setup();
    await adapter.onCloudCommand({
        sourceId: 'u-1',
        cmd: 'CMD_FCU_FROM_AC',
        payload: { data: '3143ffffffffffffffffffffffffffffffffff' },
    });
    assert.equal(adapter.states['Wohnzimmer.power'].val, false);
    assert.equal(adapter.states['Wohnzimmer.mode'].val, 'HEAT');
    assert.equal(adapter.states['Wohnzimmer.targetTemperature'].val, 22);

    await adapter.onCloudCommand({ sourceId: 'u-1', cmd: 'CMD_HEARTBEAT', payload: { iTemp: '15', oTemp: 'fd' } });
    assert.equal(adapter.states['Wohnzimmer.indoorTemperature'].val, 21);
    assert.equal(adapter.states['Wohnzimmer.outdoorTemperature'].val, -3);
});

test('polling uses the device list; rate limit pauses it and triggers re-login', async () => {
    const { ToshibaRateLimitError } = require('../lib/httpApi');
    const { adapter } = await setup();
    let listCalls = 0;
    let logins = 0;
    adapter.http = {
        getDevices: async () => {
            listCalls++;
            if (listCalls === 1) {
                throw new ToshibaRateLimitError('HTTP 403');
            }
            return [{ uniqueId: 'u-1', state: '31ffffffffffffffffffffffffffffffffffff' }];
        },
        getEnergyConsumption: async () => ({ 'u-1': 1234 }),
        login: async () => logins++,
    };
    assert.equal(await adapter.pollAll(), false);
    assert.equal(listCalls, 1);
    await adapter.pollAll(); // paused
    assert.equal(listCalls, 1);
    adapter.rateLimits.state.until = 0; // pause over
    assert.equal(await adapter.pollAll(), true);
    assert.equal(listCalls, 2);
    assert.equal(logins, 1);
    assert.equal(adapter.states['Wohnzimmer.power'].val, false);
});

test('model names: rejected units are skipped, others filled, polling not paused', async () => {
    const { ToshibaRateLimitError } = require('../lib/httpApi');
    const { adapter } = await setup();
    await adapter.setupDevice({
        acId: 'a2',
        uniqueId: 'u-2',
        name: 'Arbeitszimmer',
        state: '3143ffffffffffffffffffffffffffffffffff',
        meritFeature: '2c00',
        modelId: '2',
    });
    adapter.http = {
        getDeviceState: async acId => {
            if (acId === 'a2') {
                throw new ToshibaRateLimitError('HTTP 403');
            }
            return { state: '30', fcuModel: 'RAS-B16G3KVSG-E', cduModel: 'NULL' };
        },
        getDevices: async () => [],
    };
    await adapter.loadModelInfo();
    assert.equal(adapter.states['Wohnzimmer.info.indoorUnitModel'].val, 'RAS-B16G3KVSG-E');
    assert.equal(adapter.states['Wohnzimmer.info.outdoorUnitModel'].val, '');
    assert.equal(adapter.states['Arbeitszimmer.info.indoorUnitModel'], undefined);
    assert.equal(adapter.rateLimits.state, undefined);
    assert.equal(await adapter.pollAll(), true);
});

test('SAS token is reused while valid', async () => {
    const { adapter } = await setup();
    let registrations = 0;
    const se = Math.floor(Date.now() / 1000) + 3600;
    adapter.http = {
        registerClient: async id => {
            registrations++;
            return `SharedAccessSignature sr=hub%2Fdevices%2F${id}&sig=x&se=${se}`;
        },
    };
    const a = await adapter.getSasToken('ioBroker-1');
    const b = await adapter.getSasToken('ioBroker-1');
    assert.equal(a, b);
    assert.equal(registrations, 1);
    adapter.sasExpiry = Date.now() + 60000; // about to expire
    await adapter.getSasToken('ioBroker-1');
    assert.equal(registrations, 2);
});
