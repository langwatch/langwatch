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
DEV_ROOT_FILE="$WORKDIR/dev-stack.pid"

# Kill children before parents: `pnpm start` puts the workers (vite, the Go
# gateway, the API) in their own session, so a process-group kill rooted at the
# stack's leader misses exactly the processes that hold the ports. Parentage
# still connects them, so walk the tree instead of trusting the group.
kill_tree() {
  local pid="$1" kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$kid"
  done
  kill -9 "$pid" 2>/dev/null || true
}

if [ -s "$DEV_ROOT_FILE" ]; then
  OLD_ROOT="$(cat "$DEV_ROOT_FILE")"
  # Process ids are recycled, so a pid recorded before a reboot can name an
  # unrelated process by the time we read it. Kill it only if it still looks
  # like a dev stack.
  ROOT_CMD="$(ps -o cmd= -p "$OLD_ROOT" 2>/dev/null || true)"
  case "$ROOT_CMD" in
    "") : ;; # already gone
    *pnpm*dev*) echo "stopping previous dev stack (pid $OLD_ROOT)"; kill_tree "$OLD_ROOT" ;;
    *) echo "pid $OLD_ROOT is not a dev stack ($ROOT_CMD) — refusing to kill it" ;;
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
# The Go services outlive their parents and hold ports of their own — an
# nlpgo binary from an earlier stack was found still holding 5561 a day later.
pkill -9 -f "go run ./cmd/servic[e]" 2>/dev/null || true
pkill -9 -f "exe/service nlpg[o]" 2>/dev/null || true
pkill -9 -f "exe/service aigatewa[y]" 2>/dev/null || true
pkill -9 -f "make -C ../.. servic[e]" 2>/dev/null || true
sleep 3

# The new stack's check-ports step blocks if anything still holds its ports, and
# the refresh would report done while the app never boots. Ask about the ports
# themselves rather than about process names: a name pattern broad enough to
# catch the Go services also matches the Go linker, whose -o argument contains
# the binary path, and that is a compile step which exits on its own.
APP_PORTS="5560 5561"
port_holders() {
  local p held=""
  for p in $APP_PORTS; do
    if ss -lnt "sport = :$p" 2>/dev/null | grep -q LISTEN; then held="$held $p"; fi
  done
  echo "$held"
}
# Ask the kernel who holds the port and kill that tree, rather than guessing at
# process names. Name patterns cannot cover a stack this script did not start —
# a vite server from an older stack held 5560 and matched nothing.
free_ports() {
  local p pid pids
  for p in $APP_PORTS; do
    pids="$(ss -lntpH "sport = :$p" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
    for pid in $pids; do
      [ "$pid" = "1" ] && continue # never the init process
      echo "port $p held by pid $pid ($(ps -o cmd= -p "$pid" 2>/dev/null | cut -c1-60)) — stopping it"
      kill_tree "$pid"
    done
  done
}
free_ports

for _ in $(seq 1 15); do
  BUSY="$(port_holders)"
  [ -z "${BUSY// /}" ] && break
  echo "waiting for ports to free up:$BUSY"
  free_ports
  sleep 2
done
BUSY="$(port_holders)"
if [ -n "${BUSY// /}" ]; then
  echo "refusing to start: previous stack still holds port(s)$BUSY"
  ss -lntp 2>/dev/null | grep -E ":(${APP_PORTS// /|}) " || true
  exit 1
fi
# Two deliberate details here:
#   9>&-  the dev stack outlives this script, and an inherited lock fd would
#         keep the flock held for the life of the machine.
#   setsid  puts the dev stack in its own session, so that cleaning up a failed
#         refresh by killing the refresh's process group does not take staging
#         down with it.
setsid nohup pnpm dev > "$DEV_LOG" 2>&1 9>&- &
DEV_PID=$!

# Record the new stack's root pid so the next refresh can walk and kill the
# whole tree, including the workers that move into their own session.
echo "$DEV_PID" > "$DEV_ROOT_FILE"
echo "dev stack root pid: $DEV_PID"

echo done > "$STATUS"
