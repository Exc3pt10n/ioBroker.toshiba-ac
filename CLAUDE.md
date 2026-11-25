# Notes for Claude

All rules for development, versioning, releases and distribution via npm are in
[DEVELOPMENT.md](DEVELOPMENT.md) – follow them. In short:

- Raise the version once per pull request when shipped files change; changelog entries in English
  (`- (Exc3pt10n) …`), `common.news` in all 11 languages, at most 7 entries.
- Never create tags, GitHub releases or npm versions yourself; the release job does this after a merge.
- Create pull requests only when the maintainer asks for them.
- Before pushing: `npm run lint && npm test`; for changes to `main.js` or `lib/` also `npm run test:integration`.
