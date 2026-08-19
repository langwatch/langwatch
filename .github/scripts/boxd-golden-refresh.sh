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

cd "$HOME/langwatch"
git fetch -q origin main
git checkout -qf main
git reset -q --hard origin/main

cd langwatch
pnpm install
pnpm prisma migrate deploy

# restart the dev stack (patterns exclude this script itself)
pkill -f "bin/pnpm de[v]" 2>/dev/null || true
pkill -f "concurrentl[y]" 2>/dev/null || true
sleep 3
nohup pnpm dev > /tmp/pnpm-dev.log 2>&1 &

echo done > "$STATUS"
