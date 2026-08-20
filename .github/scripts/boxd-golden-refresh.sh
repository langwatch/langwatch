#!/bin/bash
# Runs ON the boxd golden machine (launched detached by the boxd-golden-refresh
# workflow). Writes done/failed to /tmp/golden-refresh.status for the workflow
# to poll — `boxd machine exec` wedges on long foreground commands, so all the
# slow work happens here, detached.
set -euo pipefail

STATUS=/tmp/golden-refresh.status
trap 'code=$?; if [ "$code" -ne 0 ]; then echo failed > "$STATUS"; fi' EXIT

# no TTY here: pnpm refuses destructive steps without CI=true
export CI=true

# nvm-installed node is only on the interactive PATH
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$NODE_BIN:$HOME/bin:$HOME/go/bin:/usr/local/bin:$PATH"

# Deploy the exact commit that triggered the workflow run, not whatever
# origin/main points at by the time this detached script starts — the job is
# serialized, so main can move while a run waits its turn.
EXPECTED_SHA="${1:?expected commit SHA is required}"

cd "$HOME/langwatch"
git fetch -q origin main
git checkout -qf main
git rev-parse -q --verify "${EXPECTED_SHA}^{commit}" > /dev/null
git reset -q --hard "$EXPECTED_SHA"

# app package location: platform/app since the repo restructure, langwatch/ before
if [ -d platform/app ]; then APP_DIR=platform/app; else APP_DIR=langwatch; fi

# carry the machine's .env across the restructure (it is not in the image repo)
if [ ! -f "$APP_DIR/.env" ] && [ -f langwatch/.env ]; then
  cp langwatch/.env "$APP_DIR/.env"
fi

cd "$APP_DIR"
pnpm install
if grep -q '"prisma:migrate"' package.json; then
  pnpm run prisma:migrate
else
  pnpm prisma migrate deploy
fi

# restart the dev stack (patterns exclude this script itself; SIGKILL because
# concurrently's --restart-tries -1 stack survives plain TERM)
pkill -9 -f "dev-superviso[r]" 2>/dev/null || true
pkill -9 -f "bin/pnpm de[v]" 2>/dev/null || true
pkill -9 -f "concurrentl[y]" 2>/dev/null || true
pkill -9 -f "start:ap[p]" 2>/dev/null || true
sleep 3
nohup pnpm dev > /tmp/pnpm-dev.log 2>&1 &

echo done > "$STATUS"
