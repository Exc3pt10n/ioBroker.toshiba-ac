# Hinweise für die Weiterentwicklung

## Versionierung

Jede Änderung, die gemergt werden soll, zieht die Adapter-Version **einmal pro Pull Request** hoch
(Semantic Versioning, solange < 1.0): neue Funktion → Minor, Fehlerbehebung → Patch.
Reine Änderungen an Entwicklungswerkzeugen ohne Auswirkung auf Nutzer (CI-Workflows, Tests,
Lint-Konfiguration, `CLAUDE.md`) brauchen keine neue Version.

Anzupassen sind jeweils `package.json`/`package-lock.json` (`version`), `io-package.json`
(`common.version` und neuer Eintrag oben in `common.news`) und der Changelog im `README.md`.

Nach dem Merge auf `main` setzt `.github/workflows/tag-release.yml` automatisch den annotierten
Tag `vX.Y.Z` passend zur Version in `package.json` (nur, wenn es ihn noch nicht gibt).
Bei einem Versionssprung auf einem Feature-Branch daher **keinen** Tag pushen; ein versehentlich
lokal erstellter Tag wird mit `git tag -d vX.Y.Z` wieder gelöscht.

## Automatische Tests (GitHub Actions)

`.github/workflows/tag-release.yml` setzt nach jedem Push auf `main` den Versions-Tag (siehe oben).

`.github/workflows/test.yml` läuft für Pull Requests und Pushes auf `main` (nicht für jeden Branch-Push,
sonst doppelt): Lint und Tests (Unit-Tests mit `node:test`, Paketprüfung mit `@iobroker/testing`) auf den
unterstützten Node-Versionen (22, 24), der Integrationstest (echte js-controller-Instanz) einmal auf Node 22.
Ältere Läufe desselben Branches werden abgebrochen.
Wird die Node-Mindestversion geändert: `engines` in `package.json`/`package-lock.json`, README
(Voraussetzungen) und die Matrix im Workflow gemeinsam anpassen.

## Prüfen vor dem Push

```bash
npm run lint && npm test
```
