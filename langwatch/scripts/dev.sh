#!/bin/bash

# Local development script - runs app + workers concurrently for convenience
# For production, use start.sh (workers are deployed separately)

set -eo pipefail

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true NODE_ENV=development"

pnpm run start:prepare:db

START_APP_COMMAND="pnpm run start:app"

COMMANDS=()
NAMES=()
COMMANDS+=("$RUNTIME_ENV $START_APP_COMMAND")
NAMES+=("app")

# Auto-start workers if Redis is available (convenience for local dev)
if { [ -f .env ] && grep -Eq "^(REDIS_URL|REDIS_CLUSTER_ENDPOINTS)=\"?[[:alnum:]]" .env; } \
   || [ -n "$REDIS_URL" ] \
   || [ -n "$REDIS_CLUSTER_ENDPOINTS" ]; then
  COMMANDS+=("$RUNTIME_ENV pnpm run start:workers")
  NAMES+=("workers")
fi

NAMES_STR=$(IFS=,; echo "${NAMES[*]}")
concurrently --restart-tries -1 --names "$NAMES_STR" --prefix-colors "blue,yellow" "${COMMANDS[@]}"
