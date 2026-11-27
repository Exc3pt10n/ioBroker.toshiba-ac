<img src="admin/toshiba-ac.png" width="80" alt="Logo"/>

# ioBroker.toshiba-ac

[![Test and Release](https://github.com/Exc3pt10n/ioBroker.toshiba-ac/actions/workflows/test-and-release.yml/badge.svg?branch=main)](https://github.com/Exc3pt10n/ioBroker.toshiba-ac/actions/workflows/test-and-release.yml)

Reads and controls Toshiba split air conditioners (single and multi split) via the
**Toshiba Home AC Control** cloud – the same cloud that the Toshiba Home AC Control app
([App Store](https://apps.apple.com/app/id1436487864)) uses. Every indoor unit appears as its own device with
power, operating mode, temperatures, fan, swing, special modes and – if supported – energy consumption.
Changes are pushed in real time.

> **Development note:** this adapter was built with the help of **Claude** (AI by Anthropic, via Claude Code).
> Requirements, testing on a real installation and review of every change are done by the maintainer.

## Requirements

- Air conditioners that are already set up and working in the **Toshiba Home AC Control** app
  (Wi-Fi adapter RB-N101S-G / RB-N106S-G or built-in Wi-Fi, e.g. Shorai Edge, Seiya, Daiseikai, Haori).
- User name (e-mail) and password of the app account.
- js-controller ≥ 6.0.11, Admin ≥ 7.6.20, Node.js ≥ 22.
- Outgoing connections to `mobileapi.toshibahomeaccontrols.com` (HTTPS) and
  `toshibasmaciothubv1.azure-devices.net` (MQTT, port 8883 – alternatively WebSocket on port 443).

## Installation

Install the adapter like any other adapter from the ioBroker Admin interface (*Adapters*), then create an
instance and enter the credentials of the Toshiba Home AC Control app.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| User name / password | – | Credentials of the Toshiba Home AC Control app (the password is stored encrypted) |
| State refresh interval | 10 min | Fallback polling via HTTP (1–1440 min). Changes normally arrive in real time. |
| Energy consumption refresh | 30 min | Only for units with energy reporting (5–1440 min) |
| MQTT over WebSocket | off | Enable if port 8883 is blocked in your network |

## Objects

Every **indoor unit** appears as its own device, named after the unit name in the app
(e.g. `toshiba-ac.0.Living_room`). In a **multi split system**, every indoor unit gets its own object tree.

| State | Type | Writable | Description |
| --- | --- | --- | --- |
| `power` | boolean | ✔ | On / off |
| `mode` | number | ✔ | Operating mode: `1` AUTO, `2` COOL, `3` HEAT, `4` DRY, `5` FAN_ONLY |
| `targetTemperature` | number | ✔ | Target temperature in °C (17–30, 5–13 in 8 °C frost protection mode) |
| `indoorTemperature` | number | | Room temperature in °C |
| `outdoorTemperature` | number | | Outdoor temperature in °C |
| `fanMode` | string | ✔ | `AUTO`, `QUIET`, `LOW`, `MEDIUM_LOW`, `MEDIUM`, `MEDIUM_HIGH`, `HIGH` |
| `swingMode` | string | ✔ | `OFF`, `SWING_VERTICAL`, `SWING_HORIZONTAL`, `SWING_VERTICAL_AND_HORIZONTAL`, `FIXED_1` … `FIXED_5` |
| `powerSelection` | string | ✔ | Power limit `POWER_50`, `POWER_75`, `POWER_100` |
| `meritA` | string | ✔ | Special mode: `OFF`, `ECO`, `HIGH_POWER`, `CDU_SILENT_1/2` (quiet outdoor unit), `HEATING_8C` (8 °C frost protection), `SLEEP_CARE`, `FLOOR`, `COMFORT` |
| `meritB` | string | ✔ | Fireplace mode `OFF`, `FIREPLACE_1`, `FIREPLACE_2` (only if supported) |
| `airPureIon` | boolean | ✔ | Plasma ion air purifier (only if supported) |
| `selfCleaning` | boolean | | Self cleaning is running |
| `energyConsumptionYear` | number | | Consumption of the current year in Wh (only if supported) |
| `info.*` | | | Name, ids, firmware, indoor/outdoor unit model (if provided by the cloud), raw state, last update |

The value lists (`states`) of the writable objects only contain the values that the unit supports according
to the cloud.

A value written with `ack=false` is sent to the unit. As soon as the unit reports the change, the state is
confirmed with `ack=true`. Without confirmation, the adapter reads the actual state after 15 seconds.

### Example (JavaScript adapter)

```js
// heat the living room to 22 °C
setState('toshiba-ac.0.Living_room.mode', 3); // HEAT
setState('toshiba-ac.0.Living_room.targetTemperature', 22);
setState('toshiba-ac.0.Living_room.power', true);
```

## Multi split systems

All indoor units of a multi split system share one outdoor unit, which **cannot heat and cool at the same
time**. If an indoor unit is switched to a conflicting operating mode, the unit does not accept the change or
shows a mode conflict; the adapter then reads back the actual state.

## How it works

1. Login to the Toshiba REST API (`mobileapi.toshibahomeaccontrols.com`) with the app credentials.
2. The adapter registers like another smartphone (own random client id in `info.clientId`) and receives an
   access token for Toshiba's Azure IoT Hub.
3. State changes and temperatures arrive in real time via the IoT Hub (MQTT); commands are sent the same way.

The protocol is not officially documented. The implementation follows the open source Python library
[toshiba-ac](https://github.com/KaSroka/Toshiba-AC-control) by Kamil Sroka. Changes by Toshiba can affect
the adapter at any time.

## Troubleshooting

- **Only one active session per account:** according to other integrations, the Toshiba cloud accepts only
  one active session per account. If the app is open at the same time, commands or requests may fail.
  Remedy: create a second account in the app and share the units with it, or use the app rarely.
- **"Login failed":** check the credentials by logging out and in again in the app.
- **No real-time updates / `info.connection` stays `false`:** port 8883 blocked? Enable "MQTT over WebSocket".
- **HTTP 403 for the energy consumption:** the Toshiba cloud often rejects this request. The adapter retries
  later; `energyConsumptionYear` keeps the last value until then.
- **HTTP 403 / 429:** the Toshiba cloud limits the request rate. The adapter then waits at least 10 minutes;
  do not choose a very short polling interval.
- For details, set the instance log level to `debug`; the raw states are also in `info.rawState`.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### 0.2.2 (2026-11-27)

- (Exc3pt10n) Requests to the Toshiba cloud are paced with the adapter's `delay()` function instead of an own wait function
- (Exc3pt10n) Version tags now start their own workflow run (as required by the ioBroker repository checker)

### 0.2.1 (2026-11-25)

- (Exc3pt10n) Maintenance release: first release that is published to npm by the release pipeline (trusted publishing with provenance). No functional changes

### 0.2.0 (2026-11-25)

- (Exc3pt10n) Published on npm. **Breaking** for testers who installed from GitHub (`…/tarball/main` or `…/tarball/release`): installing from GitHub is no longer possible, install the adapter from npm / the Admin interface instead
- (Exc3pt10n) **Breaking:** `mode` is now a number with role `level.mode.airconditioner` (`1` AUTO, `2` COOL, `3` HEAT, `4` DRY, `5` FAN_ONLY). Scripts that write `'HEAT'` etc. keep working, but read the value as a number now
- (Exc3pt10n) Object names in English; instance settings, title and description translated into all ioBroker languages
- (Exc3pt10n) Configurable intervals are limited in the adapter as well (1–1440 / 5–1440 minutes)
- (Exc3pt10n) An unsupported `meritB` state with custom settings (e.g. history) is kept read-only instead of being deleted
- (Exc3pt10n) Unit names that differ only in upper/lower case get distinct object ids
- (Exc3pt10n) Timers use the adapter's timer functions, so nothing keeps running after the instance stops
- (Exc3pt10n) README in English, older changelog entries moved to `CHANGELOG_OLD.md`, developer notes to `DEVELOPMENT.md`

Older changes: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

## License

MIT License – see [LICENSE](LICENSE).

Copyright (c) 2026 Exc3pt10n <kontakt@jansesoft.de>

This project is not affiliated with Toshiba Corporation. "Toshiba" is a trademark of its respective owners.
