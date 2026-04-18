#!/bin/bash

set -eo pipefail

# Fail fast if any port we'd bind to is already taken (stale `pnpm dev`,
# Docker exposing the same port, etc). Without this, we'd only discover the
# conflict 30s later after Vite/tsx finish booting.
"$(dirname "$0")/check-ports.sh"

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
