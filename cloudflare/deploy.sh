#!/usr/bin/env bash
# Mahjong Scorebook — deploy the API to Cloudflare. Double-click this file, or: bash deploy.command
# Non-interactive. Photo reading key: put it in ANTHROPIC_API_KEY.txt next to this file and run again.
cd "$(dirname "$0")"
exec > >(tee -a deploy.log) 2>&1
echo "===== $(date) deploy start"
set -euo pipefail
URL="https://mahjong-api.maxondelberthakim.workers.dev"

if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]; then
  NODE_BIN="$(dirname "$(command -v node)")"
else
  case "$(uname -m)" in arm64|aarch64) A=arm64 ;; *) A=x64 ;; esac
  V=v22.12.0
  if [ ! -x ".node/bin/node" ]; then
    if [ -x "../ipc-cloudflare/node-local/bin/node" ]; then
      echo "→ Using the Node copy from ipc-cloudflare"
      mkdir -p .node && cp -R ../ipc-cloudflare/node-local/. .node/
    else
      echo "→ Downloading a private copy of Node $V…"
      curl -fsSL "https://nodejs.org/dist/$V/node-$V-darwin-$A.tar.gz" -o "/tmp/node-$V.tgz"
      mkdir -p .node && tar -xzf "/tmp/node-$V.tgz" -C .node --strip-components=1
    fi
  fi
  NODE_BIN="$PWD/.node/bin"
fi
export PATH="$NODE_BIN:$PATH"
echo "→ Node $(node --version)"

if [ ! -d node_modules/wrangler ]; then
  echo "→ Installing wrangler…"
  npm install --no-audit --no-fund --loglevel=error
fi
W="npx --no-install wrangler"

if ! $W whoami 2>&1 | grep -qi "oauth token\|api token"; then
  echo "→ Cloudflare login needed. Opening the browser — click Allow."
  $W login
fi
$W whoami 2>&1 | grep -i "associated with\|logged in" || true

gen() { LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 48 || true; }
[ -s ADMIN_KEY.txt ] || { gen > ADMIN_KEY.txt; echo "→ New admin key saved to ADMIN_KEY.txt"; }
[ -s PIN_PEPPER.txt ] || { gen > PIN_PEPPER.txt; }
if [ ! -f .secrets-set ]; then
  echo "→ Setting ADMIN_KEY and PIN_PEPPER…"
  $W secret put ADMIN_KEY < ADMIN_KEY.txt
  $W secret put PIN_PEPPER < PIN_PEPPER.txt
  touch .secrets-set
fi
if [ -s ANTHROPIC_API_KEY.txt ]; then
  echo "→ Setting ANTHROPIC_API_KEY from ANTHROPIC_API_KEY.txt…"
  tr -d '[:space:]' < ANTHROPIC_API_KEY.txt | $W secret put ANTHROPIC_API_KEY
  touch .vision-key-set
elif [ ! -f .vision-key-set ]; then
  echo "→ No ANTHROPIC_API_KEY.txt found: photo reading stays off. Create that file with your key and run again."
fi

echo "→ Applying the database schema…"
$W d1 execute mahjong-db --remote --file=schema.sql --yes >/dev/null
echo "→ Deploying the Worker…"
$W deploy
echo
echo "→ Checking $URL"
curl -s "$URL/ping"; echo
curl -s -X POST "$URL/admin/info" -H "X-Admin-Key: $(cat ADMIN_KEY.txt)"; echo
echo "===== $(date) deploy done"
