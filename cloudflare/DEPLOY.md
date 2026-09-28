# Deploying the Mahjong Scorebook API

Everything runs on the Cloudflare **free plan** in account `maxondelberthakim@gmail.com`:

| Piece | Name | Notes |
|---|---|---|
| Worker | `mahjong-api` | `https://mahjong-api.maxondelberthakim.workers.dev` |
| D1 database | `mahjong-db` (id `cd360188-f6f5-437e-9796-c30c275d06cc`, APAC) | accounts, sessions, games, scan log, daily counters |
| KV namespace | `mahjong-photos` (id `e111d3237ed043c2878bce5050bf7b15`) | scanned photos, kept 60 days |
| Secrets | `ADMIN_KEY`, `PIN_PEPPER`, `ANTHROPIC_API_KEY` | set by `deploy.sh`; the first two are kept in `ADMIN_KEY.txt` / `PIN_PEPPER.txt` next to the script |

## First deploy (on the Mac)

```
cd "$HOME/Claude Co Work/mahjong-cloudflare" && bash deploy.sh
```

The script downloads a private copy of Node if the Mac has none, installs wrangler into this folder, logs in to Cloudflare (a browser page opens — click **Allow**), sets the secrets once, applies the database schema, deploys the Worker and prints the health check.

It asks for the **Anthropic API key** once. Create one at console.anthropic.com → API keys (a pay-as-you-go account is enough; a scan costs roughly Rp 100–200 on the default model). Paste it when asked; it is sent straight to Cloudflare and not stored on the Mac. To change the key later: `bash deploy.sh --key`.

Redeploys after code changes are the same command; nothing is asked again.

## Models and limits

Set in `wrangler.jsonc` → `vars`:

- `MODEL_DEFAULT` (`claude-sonnet-5`) reads the photo the first time; `MODEL_CAREFUL` (`claude-opus-5-5`) is used by "Read again, more carefully".
- `SCAN_DAILY_PER_USER` (60) and `SCAN_DAILY_GLOBAL` (300) cap photo reads per day; `SIGNUP_DAILY` (50) caps new accounts.

Photos are shrunk to 1568 px on the long edge before upload, which is the size the model actually looks at.

## Admin commands

The admin key lives only in `ADMIN_KEY.txt` and as the Worker secret. Never paste it into chat.

```
cd "$HOME/Claude Co Work/mahjong-cloudflare"; K=$(cat ADMIN_KEY.txt); U=https://mahjong-api.maxondelberthakim.workers.dev
curl -X POST $U/admin/info   -H "X-Admin-Key: $K"                      # counts, models, whether the vision key is set
curl -X POST $U/admin/users  -H "X-Admin-Key: $K"                      # accounts (no PINs)
curl -X POST $U/admin/scans  -H "X-Admin-Key: $K" -d '{"limit":50}'    # scan log with tile accuracy
curl -X POST $U/admin/export -H "X-Admin-Key: $K" -o mahjong-export.json   # every game and scan as JSON
curl -X POST $U/admin/migrate -H "X-Admin-Key: $K"                     # re-apply schema.sql (idempotent)
open "$U/photo/<scanId>.jpg?k=$K"                                      # the photo behind a scan
```

`tools/review.html` in the repo shows the scan log with photos and the parsed-vs-corrected tiles; open it in a browser and paste the API URL and admin key.

## Local development

```
cd cloudflare && npm install
printf 'ADMIN_KEY="uji-lokal"\nPIN_PEPPER="pepper-lokal"\nMOCK_SCAN="1"\n' > .dev.vars   # MOCK_SCAN skips the real vision call
npx wrangler d1 execute mahjong-db --local --file=schema.sql
npx wrangler dev --port 8787 --local
node ../tests/api.test.js                        # 53 checks
python3 ../tools/build.py http://127.0.0.1:8787 && node ../tests/e2e.js   # Playwright, 31 checks
```

Rebuild with `python3 tools/build.py` (no argument) before committing so `docs/` points at the real API again.

## Rollback

`npx wrangler rollback` restores the previous Worker version. D1 keeps 30 days of point-in-time history (`npx wrangler d1 time-travel restore mahjong-db --timestamp=<ISO>`).
