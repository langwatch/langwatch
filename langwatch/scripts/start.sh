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
fi

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"
if [ -z "$NODE_ENV" ]; then
  RUNTIME_ENV="$RUNTIME_ENV NODE_ENV=production"
fi

# In dev, swap to `tsx watch` for the API ONLY so backend file edits
# auto-reload without a manual `pnpm dev` restart. Vite handles the
# frontend's HMR (it's a separate process under concurrently — the API
# watch reload doesn't touch it). Production keeps plain `tsx`
# (single-shot, no watcher overhead).
#
# Workers stay on plain `tsx` even in dev: they boot heavy state
# (BullMQ connections, model registries, scenarios runtime) so a
# restart on every backend save would be costly and disruptive. If
# you're iterating on worker code specifically, restart `pnpm dev`
# manually.
if [[ "$NODE_ENV" = "development" ]]; then
  START_APP_COMMAND="pnpm run start:app:watch"
else
  START_APP_COMMAND="pnpm run start:app"
fi

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
