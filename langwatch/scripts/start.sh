#!/bin/bash

set -eo pipefail

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"
if [ -z "$NODE_ENV" ]; then
  RUNTIME_ENV="$RUNTIME_ENV NODE_ENV=production"
fi

START_APP_COMMAND="pnpm run start:app"

# Workers are started via separate deployment (production) or separate container (docker compose)
# This script only starts the app process

START_QUICKWIT_COMMAND=""
if grep -q "^ELASTICSEARCH_NODE_URL=\"\?quickwit://" .env || ([ -n "$ELASTICSEARCH_NODE_URL" ] && [[ "$ELASTICSEARCH_NODE_URL" =~ ^quickwit:// ]]); then
  START_QUICKWIT_COMMAND="pnpm run start:quickwit"
  START_APP_COMMAND="./scripts/wait-for-quickwit.sh && pnpm run start:prepare:db && pnpm run start:app"
  RUNTIME_ENV="$RUNTIME_ENV RUST_LOG=error"

  if [ ! -d "quickwit" ]; then
    echo "Quickwit was not found, installing it..."
    pnpm run setup:quickwit
  fi
else
 pnpm run start:prepare:db
fi

COMMANDS=()
NAMES=()
if [ -n "$START_APP_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV $START_APP_COMMAND\"")
  NAMES+=("app")
fi
if [ -n "$START_QUICKWIT_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV $START_QUICKWIT_COMMAND\"")
  NAMES+=("quickwit")
fi

NAMES_STR=$(IFS=,; echo "${NAMES[*]}")
concurrently --restart-tries -1 --names "$NAMES_STR" --prefix-colors "blue,yellow,magenta,cyan" "${COMMANDS[@]}"