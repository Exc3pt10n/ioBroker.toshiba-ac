'use strict';

/**
 * Determines which features an indoor unit supports, based on the "MeritFeature"
 * hex string and the "ACModelId" reported by the Toshiba cloud.
 */

const DISABLED_MERIT_B_FOR_MODE = {
    AUTO: ['FIREPLACE_1', 'FIREPLACE_2'],
    COOL: ['FIREPLACE_1', 'FIREPLACE_2'],
    DRY: ['FIREPLACE_1', 'FIREPLACE_2'],
    HEAT: [],
    FAN: ['FIREPLACE_1', 'FIREPLACE_2'],
};

const DISABLED_MERIT_A_FOR_MODE = {
    AUTO: ['HEATING_8C', 'SLEEP_CARE', 'FLOOR'],
    COOL: ['HEATING_8C', 'SLEEP_CARE', 'FLOOR'],
    DRY: ['HIGH_POWER', 'ECO', 'CDU_SILENT_1', 'CDU_SILENT_2', 'HEATING_8C', 'SLEEP_CARE', 'FLOOR'],
    HEAT: [],
    FAN: ['HIGH_POWER', 'ECO', 'CDU_SILENT_1', 'CDU_SILENT_2', 'HEATING_8C', 'SLEEP_CARE', 'FLOOR'],
};

/**
 * @param {string} meritFeature hex string, e.g. "0b00"
 * @param {string|number} modelId
 */
function getFeatures(meritFeature, modelId) {
    const model = String(modelId);
    const hex = String(meritFeature || '')
        .replace(/[^0-9a-fA-F]/g, '')
        .slice(0, 4)
        .padEnd(4, '0');
    const value = parseInt(hex, 16) || 0;
    // bit 0 = most significant bit
    const bits = [];
    for (let i = 15; i >= 0; i--) {
        bits.push(((value >> i) & 1) === 1);
    }

    const features = {
        modes: [],
        fanModes: ['AUTO', 'QUIET', 'LOW', 'MEDIUM_LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH'],
        swingModes: ['OFF', 'SWING_VERTICAL'],
        powerSelections: ['POWER_50', 'POWER_75', 'POWER_100'],
        meritB: ['OFF'],
        meritA: ['OFF', 'SLEEP_CARE', 'COMFORT'],
        airPureIon: false,
        energyReport: false,
    };

    const key = `${bits[6] ? 1 : 0}${bits[7] ? 1 : 0}`;
    features.modes = {
        '00': ['AUTO', 'COOL', 'HEAT', 'DRY', 'FAN'],
        '01': ['HEAT'],
        10: ['AUTO', 'COOL', 'DRY', 'FAN'],
        11: ['AUTO', 'COOL', 'HEAT', 'DRY', 'FAN'],
    }[key];

    if (model === '2' || model === '3') {
        features.meritA.push('HIGH_POWER', 'ECO');
        if (bits[0]) {
            features.meritA.push('FLOOR');
        }
        if (bits[1]) {
            features.swingModes.push('SWING_HORIZONTAL', 'SWING_VERTICAL_AND_HORIZONTAL');
        }
        if (bits[2]) {
            features.meritA.push('CDU_SILENT_1', 'CDU_SILENT_2');
        }
        if (bits[3]) {
            features.airPureIon = true;
        }
        if (bits[4]) {
            features.meritB.push('FIREPLACE_1', 'FIREPLACE_2');
        }
        if (bits[5]) {
            features.meritA.push('HEATING_8C');
        }
    }
    if (model === '3') {
        if (bits[14]) {
            features.swingModes.push('FIXED_1', 'FIXED_2', 'FIXED_3', 'FIXED_4', 'FIXED_5');
        }
        if (bits[15]) {
            features.energyReport = true;
        }
    }
    return features;
}

function meritAAllowedInMode(meritA, mode) {
    return !(DISABLED_MERIT_A_FOR_MODE[mode] || []).includes(meritA);
}

function meritBAllowedInMode(meritB, mode) {
    return !(DISABLED_MERIT_B_FOR_MODE[mode] || []).includes(meritB);
}

module.exports = { getFeatures, meritAAllowedInMode, meritBAllowedInMode };
