#!/usr/bin/env bash
# Mahjong Scorebook — publish the branded apps to Cloudflare Pages (free *.pages.dev addresses).
# Double-click this file (pages-deploy.command), or: bash pages-deploy.sh
# Expects pages/<name>/ folders next to this file (built by tools/build.py). Non-interactive.
cd "$(dirname "$0")"
exec > >(tee -a pages-deploy.log) 2>&1
echo "===== $(date) pages deploy start"
set -euo pipefail

# folder-in-pages/ : Pages project name (= subdomain on pages.dev)
SITES="parlour:mahjongparlour kawa:kawamahjong"

if command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]; then
  NODE_BIN="$(dirname "$(command -v node)")"
else
  NODE_BIN="$PWD/.node/bin"
fi
export PATH="$NODE_BIN:$PATH"
echo "→ Node $(node --version)"
[ -d node_modules/wrangler ] || npm install --no-audit --no-fund --loglevel=error
W="npx --no-install wrangler"

if ! $W whoami 2>&1 | grep -qi "oauth token\|api token"; then
  echo "→ Cloudflare login needed. Opening the browser — click Allow."
  $W login
fi

for pair in $SITES; do
  folder="${pair%%:*}"; project="${pair##*:}"
  [ -f "pages/$folder/index.html" ] || { echo "!! pages/$folder/index.html missing — skipped"; continue; }
  if ! $W pages project list 2>/dev/null | grep -qw "$project"; then
    echo "→ Creating Pages project ${project}…"
    $W pages project create "$project" --production-branch main || true
  fi
  echo "→ Deploying pages/$folder → https://${project}.pages.dev"
  $W pages deploy "pages/$folder" --project-name "$project" --branch main --commit-dirty=true
done
echo
for pair in $SITES; do
  project="${pair##*:}"
  printf "%s → " "https://${project}.pages.dev"; curl -s -o /dev/null -w "%{http_code}\n" "https://${project}.pages.dev/" || true
done
echo "===== $(date) pages deploy done"
