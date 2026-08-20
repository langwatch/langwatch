#!/bin/bash
# Runs ON the boxd golden machine (launched detached by the boxd-golden-refresh
# workflow). Usage: boxd-golden-refresh.sh <commit-sha> <status-file>
# Writes done/failed to the status file for the workflow to poll — `boxd machine
# exec` wedges on long foreground commands, so all the slow work happens here,
# detached.
set -euo pipefail

# Deploy the exact commit that triggered the workflow run, not whatever
# origin/main points at by the time this detached script starts — the job is
# serialized, so main can move while a run waits its turn.
EXPECTED_SHA="${1:?expected commit SHA is required}"
# Per-run status file, so a run cancelled by the job timeout cannot leave a
# status behind for the next run to read.
STATUS="${2:?status file path is required}"
LOCK=/tmp/golden-refresh.lock

# Single-flight on the machine itself. GitHub's concurrency group serializes
# the jobs, but a cancelled job leaves this script running detached, and two
# refreshes sharing one checkout and one dev stack corrupt each other.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then
    echo "lock older than 90 min — assuming abandoned, taking over"
  else
    echo "another refresh is in flight — refusing to start"
    echo failed > "$STATUS"
    exit 1
  fi
fi
echo "$EXPECTED_SHA" > "$LOCK/sha"

trap 'code=$?; if [ "$code" -ne 0 ]; then echo failed > "$STATUS"; fi; rm -rf "$LOCK"' EXIT

# no TTY here: pnpm refuses destructive steps without CI=true
export CI=true

# nvm-installed node is only on the interactive PATH
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="$NODE_BIN:$HOME/bin:$HOME/go/bin:/usr/local/bin:$PATH"

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
