<img src="admin/toshiba-ac.png" width="80" alt="Logo"/>

# ioBroker.toshiba-ac

Liest und steuert Toshiba Split-Klimaanlagen (Single- und Multi-Split) über die
**Toshiba Home AC Control** Cloud, also dieselbe Cloud, die auch die iPhone- bzw.
Android-App „Toshiba Home AC Control“ nutzt.

*English summary: ioBroker adapter for Toshiba air conditioners using the Toshiba Home AC Control cloud.
Enter your app credentials, every indoor unit appears as its own device with power, mode,
temperature, fan, swing, special modes and (if supported) energy consumption.*

## Voraussetzungen

* Klimageräte, die bereits in der App **Toshiba Home AC Control** eingerichtet sind und dort funktionieren
  (WLAN-Adapter RB-N101S-G / RB-N106S-G oder integriertes WLAN, z. B. Shorai Edge, Seiya, Daiseikai, Haori).
* Benutzername (E-Mail) und Passwort des App-Kontos.
* Node.js ≥ 20, js-controller ≥ 5.
* Ausgehende Verbindungen zu `mobileapi.toshibahomeaccontrols.com` (HTTPS) und
  `toshibasmaciothubv1.azure-devices.net` (MQTT, Port 8883 – alternativ WebSocket über Port 443).

## Installation

Solange der Adapter nicht im ioBroker-Repository ist, über „Adapter → Benutzerdefinierte Installation
(Katze-Symbol) → Von GitHub / beliebige URL“ mit der URL dieses Repositories installieren, oder per Konsole:

```bash
iobroker url https://github.com/Exc3pt10n/ioBroker.toshiba-ac
```

Danach eine Instanz anlegen und die Zugangsdaten eintragen.

## Einstellungen

| Option | Beschreibung |
| --- | --- |
| Benutzername / Passwort | Zugangsdaten der App „Toshiba Home AC Control“ (Passwort wird verschlüsselt gespeichert) |
| Intervall Zustandsabfrage | Rückfall-Abfrage per HTTP (Standard 10 min). Änderungen kommen normalerweise in Echtzeit per Push. |
| Intervall Energieverbrauch | Nur für Geräte mit Verbrauchsmessung (Standard 30 min) |
| MQTT über WebSocket | Aktivieren, wenn Port 8883 in deinem Netzwerk gesperrt ist |

## Objekte

Jedes **Innengerät** erscheint als eigenes Gerät, benannt nach dem Namen aus der App
(z. B. `toshiba-ac.0.Wohnzimmer`). Bei einer **Multi-Split-Anlage** bekommt also jedes Innengerät
seinen eigenen Objektbaum.

| State | Typ | Schreibbar | Beschreibung |
| --- | --- | --- | --- |
| `power` | boolean | ✔ | Ein / Aus |
| `mode` | string | ✔ | `AUTO`, `COOL` (Kühlen), `HEAT` (Heizen), `DRY` (Entfeuchten), `FAN` (Umluft) |
| `targetTemperature` | number | ✔ | Solltemperatur in °C (17–30, im 8 °C-Frostschutzmodus 5–13) |
| `indoorTemperature` | number | | Raumtemperatur in °C |
| `outdoorTemperature` | number | | Außentemperatur in °C |
| `fanMode` | string | ✔ | `AUTO`, `QUIET`, `LOW`, `MEDIUM_LOW`, `MEDIUM`, `MEDIUM_HIGH`, `HIGH` |
| `swingMode` | string | ✔ | `OFF`, `SWING_VERTICAL`, `SWING_HORIZONTAL`, `SWING_VERTICAL_AND_HORIZONTAL`, `FIXED_1`…`FIXED_5` |
| `powerSelection` | string | ✔ | Leistungsbegrenzung `POWER_50`, `POWER_75`, `POWER_100` |
| `meritA` | string | ✔ | Sonderfunktion: `OFF`, `ECO`, `HIGH_POWER`, `CDU_SILENT_1/2` (leises Außengerät), `HEATING_8C` (8 °C Frostschutz), `SLEEP_CARE`, `FLOOR`, `COMFORT` |
| `meritB` | string | ✔ | Kaminmodus `OFF`, `FIREPLACE_1`, `FIREPLACE_2` (nur wenn unterstützt) |
| `airPureIon` | boolean | ✔ | Plasma-Ionisator / Luftreinigung (nur wenn unterstützt) |
| `selfCleaning` | boolean | | Selbstreinigung läuft |
| `energyConsumptionYear` | number | | Verbrauch im laufenden Jahr in Wh (nur wenn unterstützt) |
| `info.*` | | | Name, IDs, Firmware, Modell Innen-/Außengerät, Rohzustand, letzte Aktualisierung |

Die Auswahllisten (`states`) der schreibbaren Objekte enthalten jeweils nur die Werte,
die das jeweilige Gerät laut Cloud unterstützt.

Ein Wert, der mit `ack=false` gesetzt wird, wird an das Gerät gesendet. Sobald das Gerät
die Änderung zurückmeldet, wird der State mit `ack=true` bestätigt. Kommt keine Bestätigung,
liest der Adapter nach 15 Sekunden den tatsächlichen Zustand nach.

### Beispiel (JavaScript-Adapter)

```js
// Wohnzimmer auf 22 °C heizen
setState('toshiba-ac.0.Wohnzimmer.mode', 'HEAT');
setState('toshiba-ac.0.Wohnzimmer.targetTemperature', 22);
setState('toshiba-ac.0.Wohnzimmer.power', true);
```

## Hinweise zu Multi-Split-Anlagen

Alle Innengeräte einer Multi-Split-Anlage hängen am selben Außengerät. Dieses kann **nicht
gleichzeitig heizen und kühlen**. Wird ein Innengerät in eine widersprüchliche Betriebsart
geschaltet, übernimmt das Gerät die Änderung nicht bzw. zeigt einen Betriebsartenkonflikt an;
der Adapter liest dann den tatsächlichen Zustand zurück.

## Funktionsweise

1. Anmeldung an der Toshiba-REST-API (`mobileapi.toshibahomeaccontrols.com`) mit den App-Zugangsdaten.
2. Der Adapter registriert sich wie ein weiteres Smartphone (eigene, zufällige Client-ID in `info.clientId`)
   und erhält ein Zugangs-Token für den Azure IoT Hub von Toshiba.
3. Über den IoT Hub (MQTT) kommen Zustandsänderungen und Temperaturen in Echtzeit; Befehle werden
   ebenfalls darüber gesendet.

Das Protokoll ist nicht offiziell dokumentiert. Die Implementierung orientiert sich an der
Open-Source-Python-Bibliothek [toshiba-ac](https://github.com/KaSroka/Toshiba-AC-control) von Kamil Sroka.
Änderungen seitens Toshiba können die Funktion jederzeit beeinträchtigen.

## Fehlersuche

* **Nur eine aktive Verbindung pro Konto:** Laut Erfahrungen anderer Integrationen akzeptiert die Toshiba-Cloud pro Konto nur eine aktive Sitzung. Ist die App gleichzeitig offen, können Befehle oder Abfragen scheitern. Abhilfe: In der App ein zweites Konto anlegen und die Geräte dafür freigeben, oder die App nur selten nutzen.

* **„Login failed“**: Zugangsdaten prüfen – mit denselben Daten in der App an- und abmelden.
* **Keine Echtzeit-Updates / `info.connection` bleibt `false`**: Port 8883 gesperrt? Option „MQTT über WebSocket“ aktivieren.
* **HTTP 403 / 429**: Die Toshiba-Cloud begrenzt die Anfragerate. Der Adapter wartet dann mindestens 10 Minuten; das Abfrageintervall nicht zu klein wählen.
* Für Details die Instanz auf Log-Level `debug` stellen; die rohen Zustände stehen auch in `info.rawState`.

## Changelog

### 0.1.3 (2026-11-12)
* HTTP 403 bei `GetCurrentACState` / Energieverbrauch behoben: Der Adapter nutzt jetzt eine einzige Kennung (`ioBroker-<clientId>`) für `Device-ID`-Header, Geräteregistrierung und IoT Hub
* SAS-Token wird wiederverwendet, solange es gültig ist
* Antworttext abgelehnter Anfragen im Debug-Log

### 0.1.2 (2026-11-11)
* HTTP 403 der Toshiba-Cloud vermeiden: mind. 1 s Abstand zwischen Anfragen, Erstabfrage nach 30 s, Energieverbrauch nach 90 s
* Nach 403/429 pausiert die Abfrage 10 min (verdoppelt sich bis 1 h), danach neuer Login; Echtzeit-Updates laufen weiter

### 0.1.1 (2026-11-11)
* Login-Fehler „HTTP 429“ behoben: Die Toshiba-Cloud verlangt seit Mitte 2026 einen `Device-ID`-Header
* Bei Ratenbegrenzung (403/429) wird mindestens 10 Minuten gewartet

### 0.1.0 (2026-11-11)
* Erste Version: Auslesen und Steuern über die Toshiba Home AC Control Cloud, Echtzeit-Updates per Azure IoT Hub, Energieverbrauch

## License

MIT License, Copyright (c) 2026 Exc3pt10n

Dieses Projekt steht in keiner Verbindung zur Toshiba Corporation. „Toshiba“ ist eine Marke der jeweiligen Inhaber.
