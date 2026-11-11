'use strict';

/**
 * Encoding/decoding of the Toshiba "FCU state" (fan coil unit = indoor unit).
 *
 * The state is transported as a hex string of 19 bytes:
 *
 *  byte  0  power status
 *  byte  1  operating mode
 *  byte  2  target temperature (signed)
 *  byte  3  fan mode
 *  byte  4  swing mode
 *  byte  5  power selection (50 / 75 / 100 %)
 *  byte  6  high nibble: merit B feature (fireplace), low nibble: merit A feature (eco, hi-power, ...)
 *  byte  7  air pure ion
 *  byte  8  indoor temperature (signed)
 *  byte  9  outdoor temperature (signed)
 *  byte 10-13 unknown
 *  byte 14  self cleaning
 *  byte 15-18 unknown
 *
 * 0xFF (or 0xF for nibbles, -1 for signed values) means "no value / do not change".
 */

const NONE = 0xff;
const NONE_HALF = 0x0f;
const STATE_LENGTH = 19;

/** Bidirectional mapping helper: names -> raw values (first raw value wins when encoding). */
function makeEnum(map, extraRawToName = {}) {
    const toRaw = {};
    const fromRaw = {};
    for (const [name, raw] of Object.entries(map)) {
        toRaw[name] = raw;
        fromRaw[raw] = name;
    }
    for (const [raw, name] of Object.entries(extraRawToName)) {
        fromRaw[raw] = name;
    }
    return {
        names: Object.keys(map),
        toRaw: name => (name in toRaw ? toRaw[name] : undefined),
        fromRaw: raw => (raw in fromRaw ? fromRaw[raw] : null),
    };
}

const ENUMS = {
    status: makeEnum({ ON: 0x30, OFF: 0x31 }),
    mode: makeEnum({ AUTO: 0x41, COOL: 0x42, HEAT: 0x43, DRY: 0x44, FAN: 0x45 }),
    fanMode: makeEnum({
        AUTO: 0x41,
        QUIET: 0x31,
        LOW: 0x32,
        MEDIUM_LOW: 0x33,
        MEDIUM: 0x34,
        MEDIUM_HIGH: 0x35,
        HIGH: 0x36,
    }),
    swingMode: makeEnum({
        OFF: 0x31,
        SWING_VERTICAL: 0x41,
        SWING_HORIZONTAL: 0x42,
        SWING_VERTICAL_AND_HORIZONTAL: 0x43,
        FIXED_1: 0x50,
        FIXED_2: 0x51,
        FIXED_3: 0x52,
        FIXED_4: 0x53,
        FIXED_5: 0x54,
    }),
    powerSelection: makeEnum({ POWER_50: 0x32, POWER_75: 0x4b, POWER_100: 0x64 }),
    // 0x01 is reported by some newer firmware and means "off" as well
    meritB: makeEnum({ OFF: 0x00, FIREPLACE_1: 0x02, FIREPLACE_2: 0x03 }, { 1: 'OFF' }),
    meritA: makeEnum({
        OFF: 0x00,
        HIGH_POWER: 0x01,
        CDU_SILENT_1: 0x02,
        ECO: 0x03,
        HEATING_8C: 0x04,
        SLEEP_CARE: 0x05,
        FLOOR: 0x06,
        COMFORT: 0x07,
        CDU_SILENT_2: 0x0a,
    }),
    airPureIon: makeEnum({ ON: 0x18, OFF: 0x10 }),
    selfCleaning: makeEnum({ ON: 0x18, OFF: 0x10 }),
};

const ENUM_FIELDS = [
    'status',
    'mode',
    'fanMode',
    'swingMode',
    'powerSelection',
    'meritB',
    'meritA',
    'airPureIon',
    'selfCleaning',
];
const TEMPERATURE_FIELDS = ['temperature', 'indoorTemperature', 'outdoorTemperature'];

function toSigned(byte) {
    return byte > 127 ? byte - 256 : byte;
}

function tempFromRaw(raw) {
    if (raw === 127 || raw === -128 || raw === -1) {
        return null;
    }
    if (raw === 126) {
        return -1;
    }
    return raw;
}

function tempToRaw(temp) {
    if (temp === null || temp === undefined) {
        return -1;
    }
    if (temp === -1) {
        return 126;
    }
    return Math.max(-128, Math.min(127, Math.round(temp)));
}

/**
 * Raw state container. All fields hold raw protocol values.
 */
class FcuState {
    constructor() {
        this.status = NONE;
        this.mode = NONE;
        this.temperature = -1;
        this.fanMode = NONE;
        this.swingMode = NONE;
        this.powerSelection = NONE;
        this.meritB = NONE_HALF;
        this.meritA = NONE_HALF;
        this.airPureIon = NONE;
        this.indoorTemperature = -1;
        this.outdoorTemperature = -1;
        this.selfCleaning = NONE;
    }

    static fromHex(hex) {
        const s = new FcuState();
        s.decode(hex);
        return s;
    }

    clone() {
        return Object.assign(new FcuState(), this);
    }

    decode(hex) {
        if (typeof hex !== 'string' || !/^[0-9a-fA-F]*$/.test(hex)) {
            throw new Error(`Invalid AC state: ${hex}`);
        }
        const padded = hex.slice(0, STATE_LENGTH * 2).padEnd(STATE_LENGTH * 2, 'f');
        const b = Buffer.from(padded, 'hex');
        this.status = b[0];
        this.mode = b[1];
        this.temperature = toSigned(b[2]);
        this.fanMode = b[3];
        this.swingMode = b[4];
        this.powerSelection = b[5];
        this.meritB = b[6] >> 4;
        this.meritA = b[6] & 0x0f;
        this.airPureIon = b[7];
        this.indoorTemperature = toSigned(b[8]);
        this.outdoorTemperature = toSigned(b[9]);
        this.selfCleaning = b[14];
    }

    encode() {
        const b = Buffer.alloc(STATE_LENGTH, NONE);
        b[0] = this.status;
        b[1] = this.mode;
        b[2] = this.temperature & 0xff;
        b[3] = this.fanMode;
        b[4] = this.swingMode;
        b[5] = this.powerSelection;
        b[6] = ((this.meritB & 0x0f) << 4) | (this.meritA & 0x0f);
        b[7] = this.airPureIon;
        b[8] = this.indoorTemperature & 0xff;
        b[9] = this.outdoorTemperature & 0xff;
        b[14] = this.selfCleaning;
        return b.toString('hex');
    }

    /**
     * Merge another (partial) state into this one. Fields with "no value" are ignored.
     *
     * @param {FcuState} other
     * @returns {boolean} true if something changed
     */
    merge(other) {
        let changed = false;
        for (const field of ENUM_FIELDS) {
            const v = other[field];
            // ignore "no value" markers and values we cannot interpret (e.g. 0x00 / 0x02 placeholders)
            if (v !== NONE && v !== NONE_HALF && v !== this[field] && ENUMS[field].fromRaw(v) !== null) {
                this[field] = v;
                changed = true;
            }
        }
        for (const field of TEMPERATURE_FIELDS) {
            const v = other[field];
            if (v !== -1 && v !== this[field]) {
                this[field] = v;
                changed = true;
            }
        }
        return changed;
    }

    // ---- readable accessors -------------------------------------------------

    get(field) {
        if (TEMPERATURE_FIELDS.includes(field)) {
            return tempFromRaw(this[field]);
        }
        return ENUMS[field].fromRaw(this[field]);
    }

    set(field, value) {
        if (TEMPERATURE_FIELDS.includes(field)) {
            this[field] = tempToRaw(value);
            return;
        }
        const raw = ENUMS[field].toRaw(value);
        if (raw === undefined) {
            throw new Error(`Invalid value "${value}" for ${field}`);
        }
        this[field] = raw;
    }

    toObject() {
        const o = {};
        for (const f of [...ENUM_FIELDS, ...TEMPERATURE_FIELDS]) {
            o[f] = this.get(f);
        }
        return o;
    }
}

module.exports = { FcuState, ENUMS, NONE, NONE_HALF, tempFromRaw };
