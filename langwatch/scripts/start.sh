#!/bin/bash

set -eo pipefail

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"
if [ -z "$NODE_ENV" ]; then
  RUNTIME_ENV="$RUNTIME_ENV NODE_ENV=production"
fi

#If on Windows, prefix the RUNTIME_ENV with && set
if [ "$OS" = "Windows_NT" ]; then
  RUNTIME_ENV_TEMP=""
  first=1
  for VAR in $RUNTIME_ENV; do
    if [ $first -eq 1 ]; then
      RUNTIME_ENV_TEMP="set \"$VAR\""
      first=0
    else
      RUNTIME_ENV_TEMP="$RUNTIME_ENV_TEMP && set \"$VAR\""
    fi
  done
  RUNTIME_ENV="$RUNTIME_ENV_TEMP"
fi

START_APP_COMMAND="npm run start:app"

START_WORKERS_COMMAND=""
# if REDIS_URL is availble on .env or set in the environment, start the workers
if grep -q "^REDIS_URL=\"[a-z]" .env || [ -n "$REDIS_URL" ]; then
  START_WORKERS_COMMAND="npm run start:workers"
fi

START_QUICKWIT_COMMAND=""
if grep -q "^ELASTICSEARCH_NODE_URL=\"\?quickwit://" .env || ([ -n "$ELASTICSEARCH_NODE_URL" ] && [[ "$ELASTICSEARCH_NODE_URL" =~ ^quickwit:// ]]); then
  START_QUICKWIT_COMMAND="npm run start:quickwit"
  START_APP_COMMAND="./scripts/wait-for-quickwit.sh && npm run start:prepare:db && npm run start:app"
  RUNTIME_ENV="$RUNTIME_ENV RUST_LOG=error"

  if [ ! -d "quickwit" ]; then
    echo "Quickwit was not found, installing it..."
    npm run setup:quickwit
  fi
else
 npm run start:prepare:db
fi

WATCH_WEBSOCKET_COMMAND=""
if [ "$NODE_ENV" = "development" ]; then
  WATCH_WEBSOCKET_COMMAND="npm run build:websocket -- --watch"
fi


SEPARATOR=" "
if [ "$OS" = "Windows_NT" ]; then 
  SEPARATOR=" && "
fi

COMMANDS=()
if [ -n "$START_APP_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV${SEPARATOR}$START_APP_COMMAND\"")
fi
if [ -n "$START_WORKERS_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV${SEPARATOR}$START_WORKERS_COMMAND\"")
fi
if [ -n "$START_QUICKWIT_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV${SEPARATOR}$START_QUICKWIT_COMMAND\"")
fi
if [ -n "$WATCH_WEBSOCKET_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV${SEPARATOR}$WATCH_WEBSOCKET_COMMAND\"")
fi

concurrently --restart-tries -1 "${COMMANDS[@]}"