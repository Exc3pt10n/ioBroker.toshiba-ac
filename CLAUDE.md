# Hinweise für die Weiterentwicklung

## Versionierung

Jede Änderung, die gemergt werden soll, zieht die Adapter-Version **einmal pro Pull Request** hoch
(Semantic Versioning, solange < 1.0): neue Funktion → Minor, Fehlerbehebung → Patch.
Reine Änderungen an Entwicklungswerkzeugen ohne Auswirkung auf Nutzer (CI-Workflows, Tests,
Lint-Konfiguration, `CLAUDE.md`) brauchen keine neue Version.

Anzupassen sind jeweils `package.json`/`package-lock.json` (`version`), `io-package.json`
(`common.version` und neuer Eintrag oben in `common.news`) und der Changelog im `README.md`.

Der Changelog-Abschnitt im README heißt `### X.Y.Z (JJJJ-MM-TT)`; daraus entstehen die Release-Notes.
Der `common.news`-Eintrag der neuen Version braucht alle 11 Sprachen (en, de, ru, pt, nl, fr, it, es,
pl, uk, zh-cn), höchstens 20 Einträge behalten. Das prüft der `release-guard` im Pull Request.

## Automatische Tests und Releases (GitHub Actions)

`.github/workflows/test.yml` bindet den zentralen Workflow
`Exc3pt10n/ioBroker-workflows/.github/workflows/adapter.yml@v1` ein (Vorlage: `templates/test.yml` dort):

- **Pull Requests:** Lint, Tests auf Node 22 und 24, Integrationstest (echte js-controller-Instanz, stabile
  Version), Installationstest wie `iobroker url` (nur ausgelieferte Dateien), `npm audit --omit=dev
  --audit-level=high` und `release-guard` (Versionsregeln). Ändert ein PR ausgelieferte Dateien
  (`admin/`, `lib/`, `main.js`, `io-package.json`, `LICENSE`), braucht er einen Versionssprung.
- **Nach dem Merge auf `main`:** Sind alle Prüfungen grün und fehlt der Tag `vX.Y.Z` zur Version in
  `package.json`, setzt der Release-Job den annotierten Tag, legt ein GitHub-Release mit den Notes aus dem
  README an und spult den Branch `release` vor.
- **Wöchentlich und per `workflow_dispatch`:** volle Matrix Linux + Windows, Node 22/24/26.
  `workflow_dispatch` auf `main` holt außerdem ein abgebrochenes Release nach.
- **Pflicht-Check** für den Branch-Schutz von `main`: `adapter / ci-result`. Den Branch `release` nicht schützen.

Tags setzt **nur** der Release-Job. Auf Feature-Branches keine Tags pushen; ein versehentlich lokal
erstellter Tag wird mit `git tag -d vX.Y.Z` wieder gelöscht.

Fehler im zentralen Workflow selbst gehören in das Repo `Exc3pt10n/ioBroker-workflows`.

Wird die Node-Mindestversion geändert: `engines` in `package.json`/`package-lock.json` und README
(Voraussetzungen) gemeinsam anpassen.

## Installationswege

| Zweck | URL für „Installieren aus eigener URL“ bzw. `iobroker url` |
|---|---|
| stabil (letztes Release) | `https://github.com/Exc3pt10n/ioBroker.toshiba-ac/tarball/release` |
| Entwicklungsstand | `https://github.com/Exc3pt10n/ioBroker.toshiba-ac/tarball/main` |

## Prüfen vor dem Push

```bash
npm run lint && npm test
```
