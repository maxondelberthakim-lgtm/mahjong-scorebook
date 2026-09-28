#!/usr/bin/env bash
# Mahjong Scorebook — deploy the API to Cloudflare (Worker + D1 + KV).
#   cd "$HOME/Claude Co Work/mahjong-cloudflare" && bash deploy.sh
# Re-run any time the code changes. Add --key to enter a new Anthropic API key.
set -euo pipefail
cd "$(dirname "$0")"
URL="https://mahjong-api.maxondelberthakim.workers.dev"

# 1. Node: use the system one if it is recent, otherwise a private copy in ./.node (nothing is installed system-wide).
if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]; then
  NODE_BIN="$(dirname "$(command -v node)")"
else
  case "$(uname -m)" in arm64|aarch64) A=arm64 ;; *) A=x64 ;; esac
  case "$(uname -s)" in Darwin) OS=darwin ;; *) OS=linux ;; esac
  V=v22.12.0
  if [ ! -x ".node/bin/node" ]; then
    echo "→ Downloading a private copy of Node $V ($OS-$A)…"
    curl -fsSL "https://nodejs.org/dist/$V/node-$V-$OS-$A.tar.gz" -o "/tmp/node-$V.tgz"
    mkdir -p .node && tar -xzf "/tmp/node-$V.tgz" -C .node --strip-components=1
  fi
  NODE_BIN="$PWD/.node/bin"
fi
export PATH="$NODE_BIN:$PATH"
echo "→ Node $(node --version)"

# 2. wrangler (Cloudflare's deploy tool), installed inside this folder only.
if [ ! -d node_modules/wrangler ]; then
  echo "→ Installing wrangler…"
  npm install --no-audit --no-fund --loglevel=error
fi
W="npx --no-install wrangler"

# 3. Cloudflare login (opens the browser once; click Allow).
if ! $W whoami 2>&1 | grep -qi "oauth token\|api token"; then
  echo "→ Logging in to Cloudflare (a browser page opens — click Allow)…"
  $W login
fi

# 4. Secrets, set once and kept on Cloudflare. ADMIN_KEY.txt stays here for admin commands; never share it.
gen() { LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 48; }
[ -s ADMIN_KEY.txt ] || { gen > ADMIN_KEY.txt; echo "→ New admin key saved to ADMIN_KEY.txt"; }
[ -s PIN_PEPPER.txt ] || { gen > PIN_PEPPER.txt; }
if [ ! -f .secrets-set ]; then
  echo "→ Setting ADMIN_KEY and PIN_PEPPER on Cloudflare…"
  $W secret put ADMIN_KEY < ADMIN_KEY.txt
  $W secret put PIN_PEPPER < PIN_PEPPER.txt
  touch .secrets-set
fi
if [ ! -f .vision-key-set ] || [ "${1:-}" = "--key" ]; then
  echo
  echo "Photo reading uses your own Anthropic API key (console.anthropic.com → API keys)."
  printf "Paste the key and press Enter (it goes straight to Cloudflare, nothing is kept here; Enter alone skips): "
  read -r -s KEY; echo
  if [ -n "${KEY:-}" ]; then
    printf '%s' "$KEY" | $W secret put ANTHROPIC_API_KEY
    touch .vision-key-set
  else
    echo "   Skipped. Photo reading stays off until you run: bash deploy.sh --key"
  fi
fi

# 5. Database schema (safe to repeat) and the Worker itself.
echo "→ Applying the database schema…"
$W d1 execute mahjong-db --remote --file=schema.sql --yes >/dev/null
echo "→ Deploying the Worker…"
$W deploy

# 6. Check.
echo
echo "→ Checking $URL"
curl -s "$URL/ping"; echo
curl -s -X POST "$URL/admin/info" -H "X-Admin-Key: $(cat ADMIN_KEY.txt)"; echo
echo
echo "Done. The app is at https://maxondelberthakim-lgtm.github.io/mahjong-scorebook/"
