# Deck of Many Turns

Electron + React 19 + TS D&D combat tracker (DM app in `app/`, Stream Deck
plugin in `plugin/`, GitHub Pages demo + bridge docs in `docs/`).

## Build & test loop

- After EVERY app change: `cd app && npm run unpack` — refreshes
  `app/release/win-unpacked`, which is what gets hand-tested (never require an
  install). The `preunpack` hook force-kills running copies; never add a
  confirmation step around it.
- `npm run dist` only for real releases. `app/release/` is gitignored.
- Typecheck both: `npx tsc --noEmit -p tsconfig.json` in `app/` AND `plugin/`.
- Verify the asar took a change: `grep -a <newString> app/release/win-unpacked/resources/app.asar`.

## Stream Deck plugin

- The installed plugin at `%APPDATA%\Elgato\StreamDeck\Plugins\com.dmtools.dnd-combat-tracker.sdPlugin`
  is a plain COPY, not a junction. `streamdeck restart` alone reloads STALE code.
  Always mirror first: `robocopy <repo>\plugin\com.dmtools.dnd-combat-tracker.sdPlugin <installed> /MIR`
  then `npx streamdeck restart com.dmtools.dnd-combat-tracker`.
  (robocopy exit code 1 = success.)
- Bridge WS: 127.0.0.1:57321. Protocol additions must stay backward compatible
  both ways (plugin ignores unknown types); document them in `docs/bridge/index.html`.

## Verification traps

- Verify the demo (`app/scripts/serve-demo.mjs`, localhost:8123) in a BROWSER,
  never by navigating the Electron window there — the preload injects the real
  `window.api` on any navigation. The demo runs the real mobile bundle and picker.
- `app/scripts/check-i18n.mjs` is DESTRUCTIVE (deletes PCs/templates) — only run
  it against a throwaway `--user-data-dir` profile.
- The phone page runs on an insecure origin (LAN HTTP): `crypto.randomUUID` is
  undefined there — use `app/src/shared/uuid.ts`.
- Main-process changes (bridge/playerServer/state) need an app restart, not a
  page reload.

## Git & releases

- Small fixes commit straight to `main`; feature branches only when explicitly
  requested. Always push after committing.
- Pushing `main` AUTO-DEPLOYS the Pages demo (`.github/workflows/pages.yml`) —
  never merge/push unfinished demo-visible work.
- Version numbers (app + plugin 4-part + README refs) are bumped ONLY at publish
  time, all together. Installers/plugins ship as GitHub Release assets, never
  committed.
- Release notes: only shipped app/plugin changes, keepachangelog categories
  (Added/Changed/…/Fixed), install steps at the BOTTOM; mirror into CHANGELOG.md
  (minus install section).
