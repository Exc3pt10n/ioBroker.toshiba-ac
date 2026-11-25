# Development

Notes for contributors. User documentation: [README.md](README.md).

## Setup and checks

```bash
npm install
npm run lint               # ESLint / Prettier (ioBroker configuration)
npm test                   # unit tests (node:test) and package tests (@iobroker/testing)
npm run test:integration   # adapter in a real js-controller test instance
```

Plain JavaScript adapter without a build step: `main.js` and `lib/` are shipped as they are.

## Structure

| File | Purpose |
| --- | --- |
| `main.js` | Adapter: objects, state handling, polling, commands |
| `lib/httpApi.js` | REST API of the Toshiba Home AC Control cloud (login, device list, registration, energy) |
| `lib/iotHub.js` | Azure IoT Hub connection (MQTT): real-time updates and commands |
| `lib/fcuState.js` | Encoding/decoding of the 19-byte unit state |
| `lib/features.js` | Supported features per unit (`MeritFeature`, model id) |
| `admin/jsonConfig.json` | Instance settings (all 11 ioBroker languages) |

## Versioning

Every change that is going to be merged raises the adapter version **once per pull request**
(semantic versioning, while < 1.0):

| Change | Version |
| --- | --- |
| New feature | Minor: 0.2.0 → 0.3.0 |
| Bug fix, small improvement | Patch: 0.2.0 → 0.2.1 |
| Incompatible change (settings, objects) | Minor, marked **Breaking** in the changelog |

Changes to development tools only (CI workflows, tests, lint configuration, `DEVELOPMENT.md`, `CLAUDE.md`)
need no new version.

Update in every release:

- `package.json` and `package-lock.json` (`version`, in the lockfile at the top and under `packages[""]`)
- `io-package.json`: `common.version` and a new entry at the top of `common.news` in all 11 languages
  (en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn). Keep **at most 7 entries** and only versions that exist on npm.
- `README.md`: section `### X.Y.Z (YYYY-MM-DD)` at the top of the changelog, entries in English in the style
  `- (Exc3pt10n) …`. The release notes are taken from this section. Older entries move to `CHANGELOG_OLD.md`.

If a pull request is extended before it is merged, it keeps this one version increase (raise patch to minor
if needed). After a merge, the next change starts with a new increase.

## Release

Releases are created automatically by the central workflow from
[Exc3pt10n/ioBroker-workflows](https://github.com/Exc3pt10n/ioBroker-workflows), included in
`.github/workflows/test-and-release.yml` via `@v1` (file name as expected by the ioBroker repository checker
and by npm trusted publishing). After a merge to `main` all checks run; only if they pass and the version from
`package.json` has no tag yet, the release job creates:

- the annotated tag `vX.Y.Z`,
- a GitHub release with the notes from the README changelog and the packed `iobroker.toshiba-ac-X.Y.Z.tgz`,
- then the `deploy` job publishes exactly this `.tgz` to npm (`npm-publish.yml`, trusted publishing, no token).

Never create or push tags, releases or npm versions yourself – especially not for a version increase on a
feature branch. A tag created locally by mistake is removed with `git tag -d vX.Y.Z`. A merge without a
version increase (e.g. tools only) creates no release.

The `release-guard` checks these rules in every pull request: if a pull request changes shipped files
(`files`/`main` from `package.json`, `io-package.json`) or runtime dependencies (also only in the lockfile,
e.g. via `npm audit fix`), the version must be increased and entered everywhere.

## Distribution via npm

The adapter is distributed via npm (parameter `npm-package: true` in the central workflow):

- There is **no** `prepare` script.
- `common.nogit` is set in `io-package.json`.
- `@iobroker/testing` stays current (6.x), `admin` as global dependency at least 7.6.20.
- Installation from GitHub (`…/tarball/…`) is not supported anymore.

One-time steps for the maintainer when the package is published for the first time:

1. After the first release, publish the `.tgz` from the GitHub release once by hand
   (`npm publish iobroker.toshiba-ac-X.Y.Z.tgz --access public`). Trusted publishing can only be configured
   once the package exists; the `deploy` job skips versions that already exist.
2. npmjs → package → Settings → Trusted publishing: GitHub Actions, owner `Exc3pt10n`, repository
   `ioBroker.toshiba-ac`, workflow `test-and-release.yml`.
3. Branch protection of `main`: required checks `adapter / ci-result` and `check-and-lint`.

Before a pull request, check the findings of the ioBroker repository checker:

```bash
npx @iobroker/repochecker https://github.com/Exc3pt10n/ioBroker.toshiba-ac <branch>
```

and run the `release-guard` locally (with a clone of ioBroker-workflows next to this repository):

```bash
node ../ioBroker-workflows/scripts/check-release.mjs pr --base origin/main --npm-package true
```

## Automated tests (GitHub Actions)

`.github/workflows/test-and-release.yml` follows the ioBroker standard layout:

- `check-and-lint`: `ioBroker/testing-action-check` (lint and package tests)
- `adapter`: central workflow – tests on Node 22 and 24, integration test, installation test of the packed
  package, `npm audit --omit=dev`, `release-guard` (pull requests) and the release (after a merge to `main`)
- `adapter-tests`: unit and integration tests with `ioBroker/testing-action-adapter` on Node 22/24/26,
  Linux, Windows and macOS
- `deploy`: publishes a new release to npm
- weekly: full matrix of the central workflow (Linux + Windows, Node 22/24/26)

Required checks in the branch protection of `main`: `adapter / ci-result` and `check-and-lint`.
Errors in the central workflow itself belong to `Exc3pt10n/ioBroker-workflows`.

When changing the minimum Node.js version: update `engines` in `package.json`/`package-lock.json` and the
README (requirements) together.

## Language

Code, log messages, object names and documentation are in English. Texts in `io-package.json`
(`titleLang`, `desc`, `news`) and `admin/jsonConfig.json` need all 11 ioBroker languages.
