# Older changes

> Changes up to 0.1.7, before the adapter was published on npm. Newer entries are in the [README](README.md#changelog).

### 0.1.7 (2026-11-14)

- (Exc3pt10n) Release notes of 0.1.6 translated into all supported languages (required by the release check of the new pipeline)

### 0.1.6 (2026-11-12)

- (Exc3pt10n) Energy consumption: the Toshiba cloud often rejects this request from third-party clients with HTTP 403. Only the first rejection of a series is logged (as info instead of warning), retries are extended up to every 6 hours, the last value is kept. A recovery is logged

### 0.1.5 (2026-11-12)

- (Exc3pt10n) HTTP 403 warnings fixed: the Toshiba cloud rejects the single-unit request `GetCurrentACState` for some indoor units (seen for multi split indoor units). States are now refreshed via the device list – one request for all units
- (Exc3pt10n) Model names (`info.indoorUnitModel`/`info.outdoorUnitModel`) are only requested at start and stay empty if the cloud does not provide them
- (Exc3pt10n) State polling and energy consumption pause independently when rate limited

### 0.1.4 (2026-11-12)

- (Exc3pt10n) Fixed "Invalid Inputs" on device registration: the Toshiba cloud only accepts device ids of the form `<username>_<id>`. This id is now also used for the `Device-ID` header and the IoT Hub
- (Exc3pt10n) Error messages of the cloud name the affected endpoint

### 0.1.3 (2026-11-12)

- (Exc3pt10n) HTTP 403 on `GetCurrentACState` / energy consumption: one identifier for the `Device-ID` header, device registration and IoT Hub
- (Exc3pt10n) The SAS token is reused while it is valid
- (Exc3pt10n) Response text of rejected requests in the debug log
- (Exc3pt10n) Node.js 22 or newer required

### 0.1.2 (2026-11-11)

- (Exc3pt10n) Avoid HTTP 403 from the Toshiba cloud: at least 1 s between requests, first refresh after 30 s, energy consumption after 90 s
- (Exc3pt10n) After 403/429 polling pauses for 10 min (doubling up to 1 h), followed by a new login; real-time updates continue

### 0.1.1 (2026-11-11)

- (Exc3pt10n) Fixed login error "HTTP 429": since mid 2026 the Toshiba cloud requires a `Device-ID` header
- (Exc3pt10n) Wait at least 10 minutes when rate limited (403/429)

### 0.1.0 (2026-11-11)

- (Exc3pt10n) First version: read and control via the Toshiba Home AC Control cloud, real-time updates via Azure IoT Hub, energy consumption
