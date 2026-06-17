#!/bin/bash

set -eo pipefail

# Fail fast if any port we'd bind to is already taken (stale `pnpm dev`,
# Docker exposing the same port, etc). Without this, we'd only discover the
# conflict 30s later after Vite/tsx finish booting.
"$(dirname "$0")/check-ports.sh"

# Dev-only: auto-derive REDIS_DB_INDEX from the PORT slot so each worktree
# lands on its own Redis DB. PORT=5560 → 0, 5570 → 1, 5580 → 2, …, 5710 → 15.
# Keeps BullMQ queues, GroupQueue streams, and the fold cache isolated across
# concurrent `pnpm dev` instances. Explicit REDIS_DB_INDEX wins.
# Skipped in production (cluster Redis only supports DB 0 anyway).
if [[ "$NODE_ENV" = "development" ]]; then
  if [ -z "$REDIS_DB_INDEX" ]; then
    _PORT_FOR_DB="${PORT:-5560}"
    REDIS_DB_INDEX=$(( (_PORT_FOR_DB - 5560) / 10 ))
    if [ "$REDIS_DB_INDEX" -lt 0 ] || [ "$REDIS_DB_INDEX" -gt 15 ]; then
      REDIS_DB_INDEX=0
    fi
    export REDIS_DB_INDEX
    echo "  ✓ redis db=${REDIS_DB_INDEX} (auto-derived from PORT=${_PORT_FOR_DB})"
  else
    echo "  ✓ redis db=${REDIS_DB_INDEX} (explicit)"
  fi

  # Dev-only: when PORT is set (the port-conflict-detector picked a non-default
  # slot, e.g. PORT=5580), align BASE_HOST and NEXTAUTH_URL to that PORT so OAuth
  # callback URLs and BetterAuth's trustedOrigins check match the actual listening
  # port. Without this, any `pnpm dev` on a non-default port hits a
  # 403 INVALID_ORIGIN on /api/auth/sign-in/social and the Auth0 redirect dies
  # before it starts. Skipped in production (NEXTAUTH_URL there is the real
  # public URL, not localhost).
  if [ -n "$PORT" ]; then
    export BASE_HOST="http://localhost:${PORT}"
    export NEXTAUTH_URL="http://localhost:${PORT}"
    echo "  ✓ BASE_HOST=NEXTAUTH_URL=${BASE_HOST} (auto-aligned to PORT=${PORT})"
  fi

  # AI Gateway port + URL auto-derivation. Default layout:
  #   PORT          (5560) control plane (Vite + Hono via proxy)
  #   PORT + 3      (5563) AI Gateway data plane (Go)
  # Each derived var is set only when unset, so explicit .env values win.
  #
  # Naming-collision note: the Go gateway reads LW_GATEWAY_BASE_URL as the
  # CONTROL PLANE URL (services/aigateway/config.go:113 — canonical,
  # higher precedence than GATEWAY_CONTROL_PLANE_URL). The TS side (CLI
  # + /me VK reveal) historically read the same var name as the GATEWAY
  # public URL — opposite direction. Pre-resolution this caused
  # `langwatch login` on PORT=5580 to advertise Gateway: localhost:6580
  # (the Hono API port) and `langwatch claude` to 404.
  #
  # Resolution: LW_GATEWAY_BASE_URL stays the Go control-plane var,
  # LW_GATEWAY_PUBLIC_URL is the dedicated TS public-URL var. Each side
  # reads its own var, no semantic collision.
  _APP_PORT="${PORT:-5560}"
  _API_PORT=$((_APP_PORT + 1000))
  GATEWAY_PORT_DERIVED=$((_APP_PORT + 3))
  if [ -z "$GATEWAY_CONTROL_PLANE_URL" ]; then
    export GATEWAY_CONTROL_PLANE_URL="http://localhost:${_API_PORT}"
  fi
  if [ -z "$LW_GATEWAY_BASE_URL" ]; then
    export LW_GATEWAY_BASE_URL="$GATEWAY_CONTROL_PLANE_URL"
  fi
  if [ -z "$LW_GATEWAY_INTERNAL_URL" ]; then
    export LW_GATEWAY_INTERNAL_URL="http://localhost:${GATEWAY_PORT_DERIVED}"
  fi
  # TS-side public URL the CLI + /me VK reveal surface to the user. In
  # dev that's the Go gateway data plane (PORT + 3), in lockstep with
  # the auto-started aigateway below.
  if [ -z "$LW_GATEWAY_PUBLIC_URL" ]; then
    export LW_GATEWAY_PUBLIC_URL="http://localhost:${GATEWAY_PORT_DERIVED}"
  fi
  if [ -z "$SERVER_ADDR" ]; then
    export SERVER_ADDR=":${GATEWAY_PORT_DERIVED}"
  fi
  echo "  ✓ gateway: port=${GATEWAY_PORT_DERIVED} cp=${GATEWAY_CONTROL_PLANE_URL:-(unset, using LW_GATEWAY_BASE_URL)} public=${LW_GATEWAY_PUBLIC_URL}"
fi

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"
if [ -z "$NODE_ENV" ]; then
  RUNTIME_ENV="$RUNTIME_ENV NODE_ENV=production"
fi

START_APP_COMMAND="pnpm run start:app"

START_WORKERS_COMMAND=""
if [[ "$START_WORKERS" = "true" || "$START_WORKERS" = "1" ]]; then
  START_WORKERS_COMMAND="pnpm run start:workers && exit 1"
fi

# In development, Vite runs on PORT (default 5560) and proxies /api/* to PORT+1000.
# In production, only the API server runs on PORT (default 5560).
START_VITE_COMMAND=""
if [[ "$NODE_ENV" = "development" ]]; then
  START_VITE_COMMAND="pnpm run dev:vite"
fi

# AI Gateway data plane (Go service). Bundled into pnpm dev so wrappers
# (langwatch claude / codex / cursor / gemini / opencode) reach a live
# gateway without a second terminal running `make service svc=aigateway`.
# Skips silently when the port is already taken (another worktree's
# gateway, or a manual run) so we don't double-bind, and when the Go
# toolchain isn't on PATH (contributors who only touch the TS app).
# Opt-out: LANGWATCH_SKIP_AIGATEWAY=1.
START_GATEWAY_COMMAND=""
if [[ "$NODE_ENV" = "development" && "$LANGWATCH_SKIP_AIGATEWAY" != "1" ]]; then
  _GATEWAY_PORT="${GATEWAY_PORT_DERIVED:-5563}"
  if ! command -v go >/dev/null 2>&1; then
    echo "  ! aigateway: skipped (Go toolchain not in PATH); run \`make service svc=aigateway\` manually"
  elif lsof -i ":$_GATEWAY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ✓ aigateway: already running on :$_GATEWAY_PORT, reusing"
  else
    START_GATEWAY_COMMAND="make -C .. service svc=aigateway"
    echo "  ✓ aigateway: auto-start on :$_GATEWAY_PORT"
  fi
fi

# nlpgo data plane (Go NLP engine). Bundled into pnpm dev so the optimization
# studio reaches a live engine without a second terminal (or `make start`).
# It binds the port the app dials via LANGWATCH_NLP_SERVICE: that port when it
# points at localhost, otherwise PORT+1 (5561 for the default 5560 app port),
# and the app is pointed there when LANGWATCH_NLP_SERVICE is unset. Skips
# silently when that port is already taken (another worktree / a manual run),
# when LANGWATCH_NLP_SERVICE points at an external host, when the Go toolchain
# isn't on PATH, and via LANGWATCH_SKIP_NLP=1.
START_NLP_COMMAND=""
if [[ "$NODE_ENV" = "development" && "$LANGWATCH_SKIP_NLP" != "1" ]]; then
  _NLP_PORT=""
  if [ -z "$LANGWATCH_NLP_SERVICE" ]; then
    _NLP_PORT=$((_APP_PORT + 1))
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
    # SERVER_ADDR overrides the inherited gateway port; LANGWATCH_ENDPOINT is
    # the app URL the engine calls back for evaluator + agent-workflow nodes
    # (mirrors compose.dev.yml).
    START_NLP_COMMAND="SERVER_ADDR=\":${_NLP_PORT}\" LANGWATCH_ENDPOINT=\"http://localhost:${_APP_PORT}\" make -C .. service svc=nlpgo"
    echo "  ✓ nlpgo: auto-start on :$_NLP_PORT"
  fi
fi

pnpm run start:prepare:db

COMMANDS=()
NAMES=()
if [ -n "$START_WORKERS_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV $START_WORKERS_COMMAND\"")
  NAMES+=("workers")
fi
if [ -n "$START_VITE_COMMAND" ]; then
  COMMANDS+=("$RUNTIME_ENV $START_VITE_COMMAND")
  NAMES+=("vite")
fi
if [ -n "$START_GATEWAY_COMMAND" ]; then
  COMMANDS+=("$START_GATEWAY_COMMAND")
  NAMES+=("gateway")
fi
if [ -n "$START_NLP_COMMAND" ]; then
  COMMANDS+=("$START_NLP_COMMAND")
  NAMES+=("nlpgo")
fi
if [ -n "$START_APP_COMMAND" ]; then
  COMMANDS+=("$RUNTIME_ENV $START_APP_COMMAND")
  NAMES+=("api")
fi

# If only one command (production), exec directly to preserve JSON log format
if [ ${#COMMANDS[@]} -eq 1 ]; then
  eval "$RUNTIME_ENV exec $START_APP_COMMAND"
else
  NAMES_STR=$(IFS=,; echo "${NAMES[*]}")
  concurrently --restart-tries -1 --names "$NAMES_STR" --prefix-colors "green,blue,yellow,magenta,cyan" "${COMMANDS[@]}"
fi
