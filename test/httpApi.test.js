'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToshibaHttpApi, ToshibaAuthError } = require('../lib/httpApi');

function mockFetch(handler) {
    const calls = [];
    global.fetch = async (url, opts) => {
        const u = new URL(url);
        calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), opts });
        const { status = 200, body } = handler(u.pathname, opts, calls.length);
        return { status, json: async () => body };
    };
    return calls;
}

test('login, device list and state', async () => {
    const calls = mockFetch(path => {
        switch (path) {
            case '/api/Consumer/Login':
                return { body: { IsSuccess: true, ResObj: { access_token: 'tok', token_type: 'Bearer', consumerId: 'c1' } } };
            case '/api/AC/GetConsumerACMapping':
                return {
                    body: {
                        IsSuccess: true,
                        ResObj: [
                            {
                                GroupName: 'Home',
                                ACList: [
                                    { Id: 'a1', DeviceUniqueId: 'u1', Name: 'Wohnzimmer', ACStateData: '30', MeritFeature: '0b00', ACModelId: '2' },
                                    { Id: 'a2', DeviceUniqueId: 'u2', Name: 'Schlafzimmer', ACStateData: '31', MeritFeature: '0b00', ACModelId: '2' },
                                ],
                            },
                        ],
                    },
                };
            case '/api/AC/GetCurrentACState':
                return { body: { IsSuccess: true, ResObj: { ACStateData: '3042', Fcu: { model_name: 'RAS-B10' }, Cdu: null } } };
        }
        return { status: 404 };
    });
    const api = new ToshibaHttpApi('user', 'pw');
    await api.login();
    const devices = await api.getDevices();
    assert.equal(devices.length, 2);
    assert.equal(devices[1].name, 'Schlafzimmer');
    assert.equal(calls[1].query.consumerId, 'c1');
    assert.equal(calls[1].opts.headers.Authorization, 'Bearer tok');
    const st = await api.getDeviceState('a1');
    assert.deepEqual(st, { state: '3042', fcuModel: 'RAS-B10', cduModel: null });
});

test('wrong credentials raise an auth error', async () => {
    mockFetch(() => ({ body: { IsSuccess: false, StatusCode: 'InvalidUserNameorPassword', Message: 'nope' } }));
    const api = new ToshibaHttpApi('user', 'bad');
    await assert.rejects(api.login(), ToshibaAuthError);
});

test('re-login on 401', async () => {
    let stateCalls = 0;
    const calls = mockFetch(path => {
        if (path === '/api/Consumer/Login') {
            return { body: { IsSuccess: true, ResObj: { access_token: 't', token_type: 'Bearer', consumerId: 'c' } } };
        }
        stateCalls++;
        return stateCalls === 1 ? { status: 401 } : { body: { IsSuccess: true, ResObj: { ACStateData: '31' } } };
    });
    const api = new ToshibaHttpApi('user', 'pw');
    await api.login();
    const st = await api.getDeviceState('a1');
    assert.equal(st.state, '31');
    assert.equal(calls.filter(c => c.path === '/api/Consumer/Login').length, 2);
});
