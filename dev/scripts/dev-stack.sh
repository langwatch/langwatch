#!/bin/bash
# The `pnpm dev` launcher: every process a local stack needs, in one terminal.
#
# It is DEVELOPMENT ONLY. Production runs each application's own `start` script
# as its own deployment (see the image's CMD); nothing here is on that path, so
# there is no production branch to keep in step.
#
# Lanes:
#   ui       apps/ui       — Vite on PORT (default 5560), proxying /api to the api lane
#   api      apps/api      — tRPC + REST + SSE on PORT + 1000
#   workers  apps/worker   — queues, schedulers, projections; metrics on PORT - 2561
#   gateway  services/aigateway (Go)  — auto-started on PORT + 3 when Go is present
#   nlpgo    services/nlpgo (Go)      — auto-started on the port the api lane dials
#
# The three Node lanes always run. The two Go lanes are conveniences: each is
# skipped, with a line saying so, when the toolchain is absent, when something
# already listens on its port, or when its opt-out variable is set.
#
# Requires `concurrently` to be resolvable from the workspace root.
#
# Usage (from the repo root, normally through the root `dev` script):
#   bash dev/scripts/dev-stack.sh
#   PORT=5570 bash dev/scripts/dev-stack.sh

set -eo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

export NODE_ENV="${NODE_ENV:-development}"

# A fresh clone ships the three AI Gateway secrets empty, and the environment
# validator requires 32 characters of each — without them every lane crashloops
# on boot with a validation error and no hint (issue #3902). Idempotent: it only
# writes a value that is missing or empty.
"$HERE/ensure-ai-gateway-secrets.sh"

# Fail fast if any port we'd bind to is already taken (a stale `pnpm dev`,
# Docker exposing the same port, …). Without this we'd only discover the
# conflict half a minute later, after Vite and tsx finish booting.
"$HERE/check-ports.sh"

APP_PORT="${PORT:-5560}"
API_PORT=$((APP_PORT + 1000))
GATEWAY_PORT=$((APP_PORT + 3))

# Auto-derive REDIS_DB_INDEX from the PORT slot so each worktree lands on its
# own Redis DB. PORT=5560 → 0, 5570 → 1, 5580 → 2, …, 5710 → 15. Keeps BullMQ
# queues, GroupQueue streams and the fold cache isolated across concurrent
# `pnpm dev` instances. An explicit REDIS_DB_INDEX wins.
if [ -z "${REDIS_DB_INDEX:-}" ]; then
  REDIS_DB_INDEX=$(((APP_PORT - 5560) / 10))
  if [ "$REDIS_DB_INDEX" -lt 0 ] || [ "$REDIS_DB_INDEX" -gt 15 ]; then
    REDIS_DB_INDEX=0
  fi
  export REDIS_DB_INDEX
  echo "  ✓ redis db=${REDIS_DB_INDEX} (auto-derived from PORT=${APP_PORT})"
else
  export REDIS_DB_INDEX
  echo "  ✓ redis db=${REDIS_DB_INDEX} (explicit)"
fi

# When PORT is set — the port-conflict check picked a non-default slot, say
# PORT=5580 — align BASE_HOST and NEXTAUTH_URL to it, so OAuth callback URLs and
# the trusted-origins check match the port actually being served. Without this a
# `pnpm dev` on a non-default port answers 403 INVALID_ORIGIN on social sign-in
# and the redirect dies before it starts.
#
# These exports reach the Go lanes too. The Node entry points load `.env` after
# this runs, which would put the committed 5560 back, so the applications
# realign on the other side of that load. Keep the two in step.
if [ -n "${PORT:-}" ]; then
  export BASE_HOST="http://localhost:${PORT}"
  export NEXTAUTH_URL="http://localhost:${PORT}"
  echo "  ✓ BASE_HOST=NEXTAUTH_URL=${BASE_HOST} (auto-aligned to PORT=${PORT})"
fi

# AI Gateway port + URL derivation. Each variable is set only when unset, so an
# explicit .env value always wins.
#
# Naming-collision note: the Go gateway reads LW_GATEWAY_BASE_URL as the CONTROL
# PLANE URL (services/aigateway/config.go — canonical, higher precedence than
# GATEWAY_CONTROL_PLANE_URL). The TypeScript side (the CLI and the virtual-key
# reveal) historically read the same name as the GATEWAY public URL — the
# opposite direction. LW_GATEWAY_BASE_URL is now the Go control-plane variable
# and LW_GATEWAY_PUBLIC_URL the dedicated public-URL one, so each side reads its
# own and there is no semantic collision left.
if [ -z "${GATEWAY_CONTROL_PLANE_URL:-}" ]; then
  export GATEWAY_CONTROL_PLANE_URL="http://localhost:${API_PORT}"
fi
if [ -z "${LW_GATEWAY_BASE_URL:-}" ]; then
  export LW_GATEWAY_BASE_URL="$GATEWAY_CONTROL_PLANE_URL"
fi
if [ -z "${LW_GATEWAY_INTERNAL_URL:-}" ]; then
  export LW_GATEWAY_INTERNAL_URL="http://localhost:${GATEWAY_PORT}"
fi
if [ -z "${LW_GATEWAY_PUBLIC_URL:-}" ]; then
  export LW_GATEWAY_PUBLIC_URL="http://localhost:${GATEWAY_PORT}"
fi
echo "  ✓ gateway: port=${GATEWAY_PORT} cp=${GATEWAY_CONTROL_PLANE_URL} public=${LW_GATEWAY_PUBLIC_URL}"

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"

# --- the Go lanes ----------------------------------------------------------

# AI Gateway data plane. Bundled in so the CLI wrappers (langwatch claude /
# codex / cursor / gemini / opencode) reach a live gateway without a second
# terminal running `make service svc=aigateway`. Skipped, with a line saying so,
# when the port is already held (another worktree's gateway, or a manual run),
# when the Go toolchain is absent, and via LANGWATCH_SKIP_AIGATEWAY=1.
START_GATEWAY_COMMAND=""
if [ "${LANGWATCH_SKIP_AIGATEWAY:-}" != "1" ]; then
  if ! command -v go >/dev/null 2>&1; then
    echo "  ! aigateway: skipped (Go toolchain not in PATH); run \`make service svc=aigateway\` manually"
  elif lsof -i ":$GATEWAY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    # A reused gateway ships ITS OWN spend, budget and auth traffic to whatever
    # control plane it was started with, which is not necessarily this
    # worktree's. Nothing about a proxying, 200-returning gateway reveals that.
    # The check that used to ask it directly (GET /debug/control-plane) went
    # with the platform application and has no home yet, so this is a bare
    # warning until it does.
    echo "  ✓ aigateway: already running on :$GATEWAY_PORT, reusing"
    echo "  ! aigateway: that process may point at ANOTHER worktree's control plane; this one is ${LW_GATEWAY_BASE_URL}"
  else
    START_GATEWAY_COMMAND="make -C \"$REPO_ROOT\" service svc=aigateway"
    echo "  ✓ aigateway: auto-start on :$GATEWAY_PORT"
  fi
fi

# nlpgo, the Go NLP engine. Bundled in so the optimization studio reaches a live
# engine without a second terminal. It binds the port the api lane dials via
# LANGWATCH_NLP_SERVICE: that port when it points at loopback, otherwise PORT+1.
#
# The address has to come out of the env files, not just the shell: the Node
# entry points load `.env` (then the `.env.portless` overlay) AFTER this script
# runs, so a pinned LANGWATCH_NLP_SERVICE is what the api lane dials while this
# shell sees nothing at all. Reading it here is what keeps engine and caller on
# one port.
START_NLP_COMMAND=""
if [ "${LANGWATCH_SKIP_NLP:-}" != "1" ]; then
  # shellcheck source=./lib/resolve-nlp-service.sh
  . "$HERE/lib/resolve-nlp-service.sh"
  resolve_nlp_service "$REPO_ROOT"
  _NLP_PORT=""
  if [ -z "${LANGWATCH_NLP_SERVICE:-}" ]; then
    _NLP_PORT=$((APP_PORT + 1))
    export LANGWATCH_NLP_SERVICE="http://localhost:${_NLP_PORT}"
  elif [[ "$LANGWATCH_NLP_SERVICE" =~ ^https?://(localhost|127\.0\.0\.1):([0-9]+) ]]; then
    _NLP_PORT="${BASH_REMATCH[2]}"
  fi
  if [ -z "$_NLP_PORT" ]; then
    echo "  ✓ nlpgo: external LANGWATCH_NLP_SERVICE=${LANGWATCH_NLP_SERVICE}, not starting a local one"
  elif ! command -v go >/dev/null 2>&1; then
    echo "  ! nlpgo: skipped (Go toolchain not in PATH); run \`make service svc=nlpgo\` manually"
  elif lsof -i ":$_NLP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ✓ nlpgo: already running on :$_NLP_PORT, reusing"
  else
    # SERVER_ADDR overrides the inherited gateway port; LANGWATCH_ENDPOINT is the
    # address the engine calls back for evaluator and agent-workflow nodes
    # (mirrors dev/compose.dev.yml).
    START_NLP_COMMAND="SERVER_ADDR=\":${_NLP_PORT}\" LANGWATCH_ENDPOINT=\"http://localhost:${APP_PORT}\" make -C \"$REPO_ROOT\" service svc=nlpgo"
    echo "  ✓ nlpgo: auto-start on :$_NLP_PORT"
  fi
fi

# --- the lanes -------------------------------------------------------------

COMMANDS=()
NAMES=()

# Workers first, so the queue consumers are up before anything can enqueue.
COMMANDS+=("$RUNTIME_ENV pnpm -s --filter @langwatch/worker dev")
NAMES+=("workers")

COMMANDS+=("$RUNTIME_ENV pnpm -s --filter @langwatch/ui dev")
NAMES+=("ui")

if [ -n "$START_GATEWAY_COMMAND" ]; then
  COMMANDS+=("$START_GATEWAY_COMMAND")
  NAMES+=("gateway")
fi
if [ -n "$START_NLP_COMMAND" ]; then
  COMMANDS+=("$START_NLP_COMMAND")
  NAMES+=("nlpgo")
fi

COMMANDS+=("$RUNTIME_ENV pnpm -s --filter @langwatch/platform-api dev")
NAMES+=("api")

NAMES_STR=$(
  IFS=,
  echo "${NAMES[*]}"
)
# A lane that exits non-zero takes the stack down with its error as the last
# thing printed. Restarting it (`--restart-tries -1`) turned a config refusal
# into an endless reboot loop that scrolled the cause off the screen; the
# lanes that reload on file changes (vite, tsx watch, air) do that themselves.
exec pnpm -s exec concurrently \
  --kill-others-on-fail \
  --names "$NAMES_STR" \
  --prefix-colors "green,blue,yellow,magenta,cyan" \
  "${COMMANDS[@]}"
