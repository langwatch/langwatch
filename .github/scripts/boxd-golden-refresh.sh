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
# Everything this refresh writes lives beside the status file, in the private
# 0700 directory the workflow creates. Nothing goes to a world-writable path,
# so no other local user can pre-create or symlink what we open.
WORKDIR="$(dirname "$STATUS")"
LOCK="$WORKDIR/golden-refresh.lock"
DEV_LOG="$WORKDIR/pnpm-dev.log"

# Single-flight on the machine itself. GitHub's concurrency group serializes
# the jobs, but a cancelled job leaves this script running detached, and two
# refreshes sharing one checkout and one dev stack corrupt each other.
#
# The lock is kernel-held: flock is bound to this process through fd 9 and the
# kernel drops it when the process dies, however it dies. Nothing times a lock
# out or reclaims one, so a refresh that runs long is never overtaken, and a
# refresh that is killed never leaves a lock behind.
exec 9> "$LOCK"
if ! flock -n 9; then
  echo "another refresh holds $LOCK — refusing to start"
  echo failed > "$STATUS"
  exit 1
fi
echo "$EXPECTED_SHA $$" >&9

# Record our own process group so the workflow can kill the whole tree — pnpm,
# prisma and their children — if the run fails or is cancelled. Read from the
# kernel rather than assumed from the launcher's $!, which is only the process
# group id when setsid happens not to fork.
PGID_FILE="${STATUS%.status}.pgid"
ps -o pgid= -p $$ | tr -d '[:space:]' > "$PGID_FILE"

trap 'code=$?; if [ "$code" -ne 0 ]; then echo failed > "$STATUS"; fi' EXIT

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
# Two deliberate details here:
#   9>&-  the dev stack outlives this script, and an inherited lock fd would
#         keep the flock held for the life of the machine.
#   setsid  puts the dev stack in its own session, so that cleaning up a failed
#         refresh by killing the refresh's process group does not take staging
#         down with it.
setsid nohup pnpm dev > "$DEV_LOG" 2>&1 9>&- &

echo done > "$STATUS"
