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
# `|| true`: under `set -o pipefail` an unmatched glob would abort the refresh
# here with no message at all, rather than failing later where the log says why.
NODE_BIN="$( { ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null || true; } | sort -V | tail -1)"
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

# Stop the previous dev stack by process group. Name patterns are not enough:
# the API server runs as `tsx src/server.mts`, which matches none of the
# patterns below, so pattern-only kills left an old server alive holding the
# app port. A stale server answering the health and collector gates would make
# a refresh look verified while serving the previous commit — the gates check
# git HEAD, which the reset already moved.
DEV_PGID_FILE="$WORKDIR/dev-stack.pgid"
if [ -s "$DEV_PGID_FILE" ]; then
  OLD_PGID="$(cat "$DEV_PGID_FILE")"
  # Process ids are recycled, so a pgid recorded before a reboot can name an
  # unrelated group by the time we read it. Kill it only if its leader still
  # looks like a dev stack.
  LEADER_CMD="$(ps -o cmd= -p "$OLD_PGID" 2>/dev/null || true)"
  case "$LEADER_CMD" in
    "") : ;; # already gone
    *pnpm*dev*) kill -9 -"$OLD_PGID" 2>/dev/null || true ;;
    *) echo "pgid $OLD_PGID is not a dev stack ($LEADER_CMD) — refusing to kill it" ;;
  esac
fi

# Patterns still run, for stacks started before the pgid file existed and for
# anything started outside a refresh. SIGKILL because concurrently's
# --restart-tries -1 stack survives plain TERM; bracket escapes so the patterns
# cannot match this script itself.
pkill -9 -f "dev-superviso[r]" 2>/dev/null || true
pkill -9 -f "bin/pnpm de[v]" 2>/dev/null || true
pkill -9 -f "concurrentl[y]" 2>/dev/null || true
pkill -9 -f "start:ap[p]" 2>/dev/null || true
pkill -9 -f "tsx/dist/cli.mjs src/server.mt[s]" 2>/dev/null || true
pkill -9 -f "loader.mjs src/server.mt[s]" 2>/dev/null || true
sleep 3

# Nothing may still hold the app port, or the new stack's check-ports step
# blocks and the refresh reports done while the app never boots.
for _ in $(seq 1 10); do
  # `|| true` inside the substitution: pgrep exits 1 when nothing matches, and
  # under `set -o pipefail` that failure would abort the whole refresh at the
  # exact moment the loop has succeeded.
  HOLDERS="$( { pgrep -f "src/server.mt[s]" || true; } | tr '\n' ' ')"
  [ -z "${HOLDERS// /}" ] && break
  echo "waiting for old API server(s) to exit: $HOLDERS"
  sleep 2
done
# Two deliberate details here:
#   9>&-  the dev stack outlives this script, and an inherited lock fd would
#         keep the flock held for the life of the machine.
#   setsid  puts the dev stack in its own session, so that cleaning up a failed
#         refresh by killing the refresh's process group does not take staging
#         down with it.
setsid nohup pnpm dev > "$DEV_LOG" 2>&1 9>&- &
DEV_PID=$!

# Record the new stack's process group so the next refresh can stop all of it,
# including the API server that no name pattern matches. Read from the kernel:
# $! is only the group id when setsid does not fork.
sleep 1
ps -o pgid= -p "$DEV_PID" 2>/dev/null | tr -d '[:space:]' > "$DEV_PGID_FILE" || true
echo "dev stack pgid: $(cat "$DEV_PGID_FILE" 2>/dev/null || echo unknown)"

echo done > "$STATUS"
