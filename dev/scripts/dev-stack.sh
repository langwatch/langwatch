#!/bin/bash
# The `pnpm dev` launcher: every process a local stack needs, in one terminal.
#
# It is DEVELOPMENT ONLY. Production runs each application's own `start` script
# as its own deployment (see the image's CMD); nothing here is on that path, so
# there is no production branch to keep in step.
#
# Lanes (ADR-004, amendment 2026-09-07 — the local topology):
#   ui       apps/ui           — Vite on PORT (default 5560), proxying /api to
#                                the backend lane
#   backend  tools/dev-runtime — the API application AND the worker application
#                                in ONE Node process: tRPC + REST + SSE on
#                                PORT + 1000, worker metrics on PORT - 2561.
#                                It migrates both schemas first (apps/api's
#                                start:prepare:db), so a stack has exactly one
#                                migrator. Restart-on-change, debounced.
#   go       cmd/service       — aigateway AND nlpgo in ONE Go process, on the
#                                same two ports they bind on their own.
#   langy    services/langyagent (Go) — its own lane: it owns per-conversation
#                                worker subprocesses, so it must not be
#                                restarted with the rest of the Go code.
#
# The ui and backend lanes always run. The go lane is a convenience: it is
# skipped, with a line saying so, when the toolchain is absent, when its ports
# are already held, or when both opt-out variables are set. Production is
# unchanged — three Node deployments and separate Go services.
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

# The Langy block a local agent manager needs — the shared secret, the session
# and workspace roots, the isolation bypass a laptop cannot do without, and the
# rollout flag that renders the panel. Same guarantees: only a missing value is
# written, and nothing at all in production.
"$HERE/ensure-langy-dev-env.sh"

# The port each lane binds, exported so the lane actually gets it. The Node
# lanes load the workspace env files with `--env-file-if-exists`, which never
# overwrites a variable already set, so an exported value beats the committed
# one and a value merely set in this shell reaches nothing at all. Deriving the
# api lane's port and NOT exporting it is what made the api process fall
# through to PORT — the browser application's — and die on boot with
# EADDRINUSE, taking the Vite proxy and the gateway's control-plane calls with
# it. Sourced by the pre-flight below too, so what is reserved and what is
# handed out cannot drift apart.
# shellcheck source=./lib/derive-dev-ports.sh
. "$HERE/lib/derive-dev-ports.sh"
derive_dev_ports

# Fail fast if any port we'd bind to is already taken (a stale `pnpm dev`,
# Docker exposing the same port, …). Without this we'd only discover the
# conflict half a minute later, after Vite and tsx finish booting.
"$HERE/check-ports.sh"

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

# The quiet window every restart-on-change lane waits out before it acts. An
# agent editing across a feature package writes hundreds of files in a few
# seconds; without a window that is hundreds of restarts, each one reconnecting
# to Postgres, ClickHouse and Redis. One knob, so the Node lane's debouncer and
# the Go lane's rebuild delay can never drift apart.
export LANGWATCH_DEV_WATCH_DEBOUNCE_MS="${LANGWATCH_DEV_WATCH_DEBOUNCE_MS:-750}"

# --- the Go lane -----------------------------------------------------------
#
# One process hosts both data-plane services (`service combined`). Each is
# still selected on its own, and each still binds the port this script
# reserved for it — SERVER_ADDR cannot answer for two listeners, so each has
# its own address variable.
GO_SERVICES=()

# AI Gateway data plane. Bundled in so the CLI wrappers (langwatch claude /
# codex / cursor / gemini / opencode) reach a live gateway without a second
# terminal running `make service svc=aigateway`. Skipped, with a line saying so,
# when the port is already held (another worktree's gateway, or a manual run),
# when the Go toolchain is absent, and via LANGWATCH_SKIP_AIGATEWAY=1.
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
    # SERVER_ADDR is what the gateway actually binds; GATEWAY_PORT is only the
    # number this script reserved and announced. Passing it is what keeps the
    # two in step — `make service` re-applies the inbound environment over
    # `.env`, so this wins there as well.
    GO_SERVICES+=(aigateway)
    export LANGWATCH_GO_AIGATEWAY_ADDR=":${GATEWAY_PORT}"
    echo "  ✓ aigateway: auto-start on :$GATEWAY_PORT (in the go lane)"
  fi
fi

# nlpgo, the Go NLP engine. Bundled in so the optimization studio reaches a live
# engine without a second terminal. It binds the port the api lane dials via
# LANGWATCH_NLP_SERVICE: that port when it points at loopback, otherwise PORT+1.
#
# The address has to come out of `.env`, not just the shell: the Node entry
# points load it AFTER this script runs, so a pinned LANGWATCH_NLP_SERVICE is
# what the api lane dials while this shell sees nothing at all. Reading it here
# is what keeps engine and caller on one port.
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
    GO_SERVICES+=(nlpgo)
    export LANGWATCH_GO_NLPGO_ADDR=":${_NLP_PORT}"
    export LANGWATCH_ENDPOINT="${LANGWATCH_ENDPOINT:-http://localhost:${APP_PORT}}"
    echo "  ✓ nlpgo: auto-start on :$_NLP_PORT (in the go lane)"
  fi
fi

# langyagent, the Go agent manager Langy turns run in. Started here for the same
# reason as the other two: a chat opened in a local app otherwise dispatches to
# a dead port and says "Langy stopped mid-reply", and nothing in the log names
# the missing service. The manager itself is about 30 MB and opens no database
# client; what costs is the per-conversation worker, and the lane caps that pool
# to a local size. The decision has more branches than the other Go lanes, so it
# lives in its own planner.
START_LANGY_COMMAND=""
# shellcheck source=./lib/plan-langy-lane.sh
. "$HERE/lib/plan-langy-lane.sh"
plan_langy_lane "$REPO_ROOT" "$APP_PORT"
langy_lane_summary
if [ "$LANGY_LANE_DECISION" = "start" ]; then
  START_LANGY_COMMAND="$(langy_lane_command "$REPO_ROOT" "$LANGY_LANE_PORT")"
fi

# --- the lanes -------------------------------------------------------------

COMMANDS=()
NAMES=()
GO_LANE_COMMAND=""
if [ ${#GO_SERVICES[@]} -gt 0 ]; then
  # One binary, both services, one signal handler. `service-watch` is air:
  # it rebuilds on a Go change and only restarts when the build succeeded, so
  # a broken edit leaves the previous process serving. Its delay is the same
  # quiet window the Node lane debounces on.
  GO_LANE_COMMAND="make -C \"$REPO_ROOT\" service-watch svc=combined args=\"${GO_SERVICES[*]}\""
  echo "  ✓ go lane: ${GO_SERVICES[*]} in one process"
fi

# Every lane's output goes through the shared renderer, so a `pnpm dev`
# terminal reads exactly like a `haven logs` one: one clock, one lane column,
# one level column, whatever library the lane logs with. See
# dev/docs/best_practices/dev-log-format.md; LANGWATCH_RAW_LOGS=1 opts out.
# concurrently's own prefix would then be a second lane column, so it is off.
add_lane() {
  NAMES+=("$1")
  COMMANDS+=("bash \"$HERE/lane.sh\" $1 \"$2\"")
}

add_lane ui "$RUNTIME_ENV pnpm -s --filter @langwatch/ui dev"

if [ -n "$GO_LANE_COMMAND" ]; then
  add_lane go "$GO_LANE_COMMAND"
fi
if [ -n "$START_LANGY_COMMAND" ]; then
  add_lane langy "$START_LANGY_COMMAND"
fi

# Last, and one lane: the API application and the worker application share this
# process. It boots the worker first, so the queue consumers are attached
# before anything can enqueue, and it migrates both schemas before either
# starts.
add_lane backend "$RUNTIME_ENV pnpm -s --filter @langwatch/dev-runtime dev"

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
  --prefix none \
  "${COMMANDS[@]}"
