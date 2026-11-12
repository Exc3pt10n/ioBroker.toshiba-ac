'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FcuState } = require('../lib/fcuState');
const { getFeatures, meritAAllowedInMode } = require('../lib/features');

// 19-byte state: on, cool, 22 °C, fan auto, swing vertical, 100 %, merit 0/0,
// ion off, indoor 22 °C, outdoor 11 °C, ..., self cleaning off
const SAMPLE = '30421641416400101 60b 00001002 10 02010000'.replace(/ /g, '');

test('decodes a full state', () => {
    const s = FcuState.fromHex(SAMPLE);
    assert.deepEqual(s.toObject(), {
        status: 'ON',
        mode: 'COOL',
        fanMode: 'AUTO',
        swingMode: 'SWING_VERTICAL',
        powerSelection: 'POWER_100',
        meritB: 'OFF',
        meritA: 'OFF',
        airPureIon: 'OFF',
        selfCleaning: 'OFF',
        temperature: 22,
        indoorTemperature: 22,
        outdoorTemperature: 11,
    });
});

test('encode keeps known fields and fills unknown bytes with ff', () => {
    const s = FcuState.fromHex(SAMPLE);
    assert.equal(s.encode(), '30421641416400101 60b ffffffff 10 ffffffff'.replace(/ /g, ''));
});

test('negative temperatures and "no value" markers', () => {
    const s = FcuState.fromHex('ffffffffffffffff f6 7f'.replace(/ /g, ''));
    assert.equal(s.get('indoorTemperature'), -10);
    assert.equal(s.get('outdoorTemperature'), null);
    assert.equal(s.get('status'), null);
    const m = new FcuState();
    m.set('outdoorTemperature', -1);
    assert.equal(m.encode().slice(18, 20), '7e');
});

test('partial command: only target temperature', () => {
    const c = new FcuState();
    c.set('temperature', 22);
    assert.equal(c.encode(), `ffff16${'f'.repeat(32)}`);
    assert.equal(c.encode().length, 38);
});

test('partial command: merit A uses the low nibble', () => {
    const c = new FcuState();
    c.set('meritA', 'ECO');
    assert.equal(c.encode().slice(12, 14), 'f3');
    const d = new FcuState();
    d.set('meritB', 'FIREPLACE_1');
    assert.equal(d.encode().slice(12, 14), '2f');
});

test('merge ignores "no value" fields', () => {
    const s = FcuState.fromHex(SAMPLE);
    const upd = new FcuState();
    upd.set('mode', 'HEAT');
    assert.equal(s.merge(upd), true);
    assert.equal(s.get('mode'), 'HEAT');
    assert.equal(s.get('status'), 'ON');
    assert.equal(s.get('temperature'), 22);
    assert.equal(s.merge(upd), false);
});

test('merge ignores placeholder values like status 0x02', () => {
    const s = FcuState.fromHex(SAMPLE);
    s.merge(FcuState.fromHex('02ffffffffffffffffffffffffffffffffffff'));
    assert.equal(s.get('status'), 'ON');
});

test('invalid input is rejected', () => {
    assert.throws(() => FcuState.fromHex('xyz'));
});

test('features: basic model', () => {
    const f = getFeatures('0000', '1');
    assert.deepEqual(f.modes, ['AUTO', 'COOL', 'HEAT', 'DRY', 'FAN']);
    assert.deepEqual(f.meritA, ['OFF', 'SLEEP_CARE', 'COMFORT']);
    assert.equal(f.airPureIon, false);
});

test('features: model 3 with all flags', () => {
    const f = getFeatures('ffff', '3');
    assert.ok(f.meritA.includes('HEATING_8C'));
    assert.ok(f.meritB.includes('FIREPLACE_2'));
    assert.ok(f.swingModes.includes('FIXED_5'));
    assert.equal(f.airPureIon, true);
    assert.equal(f.energyReport, true);
});

test('features: cooling only / heating only and short merit strings', () => {
    assert.deepEqual(getFeatures('02', '2').modes, ['AUTO', 'COOL', 'DRY', 'FAN']); // "0200"
    assert.deepEqual(getFeatures('0100', '2').modes, ['HEAT']);
});

test('merit A restrictions per mode', () => {
    assert.equal(meritAAllowedInMode('ECO', 'COOL'), true);
    assert.equal(meritAAllowedInMode('HEATING_8C', 'COOL'), false);
    assert.equal(meritAAllowedInMode('HEATING_8C', 'HEAT'), true);
});
