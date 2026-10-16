#!/usr/bin/env bash
# Starts the "langy" connected agent in the background against this worktree's haven stack.
# Log: $LOG_DIR/langy-agent.log, pid: $LOG_DIR/langy-agent.pid. Stop: kill "$(cat "$LOG_DIR/langy-agent.pid")"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SLUG="${HAVEN_STACK:-$(basename "$REPO")}"
LOG_DIR="${LOG_DIR:-/tmp/langy-hooks-dogfood}"
mkdir -p "$LOG_DIR"

if [ -f "$LOG_DIR/langy-agent.pid" ] && kill -0 "$(cat "$LOG_DIR/langy-agent.pid")" 2>/dev/null; then
  echo "already running (pid $(cat "$LOG_DIR/langy-agent.pid")), log $LOG_DIR/langy-agent.log"
  exit 0
fi

[ -d "$HERE/node_modules" ] || (cd "$HERE" && npm install --no-audit --no-fund)

# The api answers on loopback over plain HTTP; the SDK allows cleartext only to loopback.
if [ -z "${LANGWATCH_ENDPOINT:-}" ]; then
  API_PORT="$(haven status --json stacks --agent | SLUG="$SLUG" node -e '
    const stacks = JSON.parse(require("fs").readFileSync(0, "utf8")).stacks;
    console.log(stacks.find((s) => s.slug === process.env.SLUG).apiPort);')"
  export LANGWATCH_ENDPOINT="http://127.0.0.1:$API_PORT"
fi
# The seeded admin's personal key: a fixed local-dev value (apps/tasks/src/storage-seed).
export LANGWATCH_API_KEY="${LANGWATCH_API_KEY:-sk-lw-LocalDevPrivate1_LocalDevPrivateAccessTokenSecretFixedValue000000}"
export LANGWATCH_PROJECT_ID="${LANGWATCH_PROJECT_ID:-local-dev-project}"

cd "$HERE"
setsid nohup node src/agent.ts >"$LOG_DIR/langy-agent.log" 2>&1 </dev/null &
echo $! >"$LOG_DIR/langy-agent.pid"
echo "langy agent started (pid $!) against $LANGWATCH_ENDPOINT, log $LOG_DIR/langy-agent.log"
