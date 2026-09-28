# Mahjong Scorebook

A phone-first web app that keeps mahjong scores. Pick the rules (Hong Kong, Singapore, Japanese Riichi, Taiwanese 16-tile, Chinese Official, or custom points), enter the four players, and after each hand record who won, how, and with what. The app works out the faan / tai / han, splits the payments, rotates the dealer, and keeps the ledger. Photograph the winner's hand and it reads the tiles for you.

- **App:** https://maxondelberthakim-lgtm.github.io/mahjong-scorebook/ (installable: *Add to Home Screen*)
- **API:** https://mahjong-api.maxondelberthakim.workers.dev (Cloudflare Worker + D1 + KV, see `cloudflare/DEPLOY.md`)

## How it fits together

```
Phone browser ──► GitHub Pages PWA (docs/index.html: Preact UI + scoring engine, offline-capable)
                     │ POST /rpc  text/plain {fn, args, token}   (no CORS preflight)
                     ▼
    Cloudflare Worker "mahjong-api"
      ├─ D1 "mahjong-db": users (name + PIN), sessions, games (one JSON row each), scans, daily counters
      ├─ KV "mahjong-photos": scanned photos, 60-day expiry, for accuracy review
      └─ Claude API (vision, JSON schema output) ← photo of the winning hand
```

- Without an account the app still works: games live in the browser's storage. Signing in (name + 4–8 digit PIN) saves games to the account, syncs them to any phone you sign in on, and turns on photo reading.
- One phone keeps score. Last write wins when the same game is edited from two phones.
- Photo reading: the phone shrinks the photo to 1568 px, the Worker sends it to Claude with the ruleset's tile prompt and a strict JSON schema, the tiles land in the editor for checking, and when the hand is saved the corrected tiles are logged against the scan so accuracy can be measured per tile (`/admin/scans`, `tools/review.html`).
- End of session: standings, **settle up** (fewest transfers in Rupiah or points), copy summary, CSV, JSON backup, JSON import.

## Repo map

| Path | What |
|---|---|
| `src/engine.js` | Scoring engine, pure JS (UMD). Rules, hand decomposition, payments, dealer rotation, scan prompt + parser, settlement. |
| `src/app.src.html` | The UI (Preact + htm). Placeholders are filled by the build. |
| `src/vendor/` | Preact 10.26.4, hooks, htm 3.1.1 (inlined at build time). |
| `src/test.js`, `test2.js`, `test3.js` | Engine tests: 56 + 16 + 20 checks. `cd src && node test.js && node test2.js && node test3.js` |
| `tools/build.py` | Builds `docs/` (PWA) and the Worker's `engine.js` / `schema.js`. `python3 tools/build.py [api-url]` |
| `tools/api-url.txt` | The API URL baked into the app. |
| `tools/sw.js`, `tools/manifest.webmanifest`, `tools/icons.py` | PWA pieces. |
| `tools/review.html` | Scan accuracy review page (needs the admin key; open locally). |
| `docs/` | **Generated.** What GitHub Pages serves. Never hand-edit. |
| `cloudflare/` | Worker source, D1 schema, `wrangler.jsonc`, `deploy.sh`, `DEPLOY.md`. `cloudflare/src/engine.js` and `schema.js` are generated. |
| `tests/api.test.js` | 53 backend checks against `wrangler dev --local`. |
| `tests/e2e.js` | 31 Playwright checks driving the built app end to end (sign-in, record by tiles, photo scan, settle, export, undo, sync, import). |

## Change workflow

1. Edit `src/` or `cloudflare/src/worker.js`; add tests.
2. `cd src && node test.js && node test2.js && node test3.js`
3. Backend: `cd cloudflare && npx wrangler dev --port 8787 --local` then `node tests/api.test.js`.
4. App: `python3 tools/build.py http://127.0.0.1:8787 && node tests/e2e.js`, then `python3 tools/build.py` to point `docs/` back at the real API.
5. Commit and push `docs/` (GitHub Pages redeploys in about a minute). If the Worker changed: `bash deploy.sh` in the `mahjong-cloudflare` folder on the Mac.

## Rules as implemented

Default values follow the common references (Hong Kong 3 faan to win with the half-spicy table, Singapore 1 tai and cap 5 with animals and instant payouts, Riichi with full fu/han and uma/oka, Taiwanese base 30 + 10 per tai with dealer streak tai, MCR 81 fan ticked by hand, custom points). Hong Kong, Singapore and Taiwanese pattern values are editable per game; Riichi and MCR follow their published standards. Liability (包) is a manual pick. Details and the engine model are in the header comments of `src/engine.js`.

## Roadmap

Live table (all four phones see the same scoreboard), player profiles and stats across games, Bahasa Indonesia / Chinese UI, automatic pay-all triggers for Singapore and Hong Kong, more systems (Malaysian, Filipino, Sichuan, 3-player Riichi).
