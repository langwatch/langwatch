#!/bin/bash

set -eo pipefail

RUNTIME_ENV="DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"
if [ -z "$NODE_ENV" ]; then
  RUNTIME_ENV="$RUNTIME_ENV NODE_ENV=production"
fi

START_APP_COMMAND="pnpm run start:app"

START_WORKERS_COMMAND=""
if [[ "$START_WORKERS" = "true" || "$START_WORKERS" = "1" ]]; then
  START_WORKERS_COMMAND="pnpm run start:workers && exit 1"
fi

pnpm run start:prepare:db

COMMANDS=()
NAMES=()
if [ -n "$START_WORKERS_COMMAND" ]; then
  COMMANDS+=("\"$RUNTIME_ENV $START_WORKERS_COMMAND\"")
  NAMES+=("workers")
fi
if [ -n "$START_APP_COMMAND" ]; then
  COMMANDS+=("$RUNTIME_ENV $START_APP_COMMAND")
  NAMES+=("app")
fi

# If only one command, exec directly to preserve JSON log format
# (concurrently adds prefixes that break JSON parsing)
if [ ${#COMMANDS[@]} -eq 1 ]; then
  eval "$RUNTIME_ENV exec $START_APP_COMMAND"
else
  NAMES_STR=$(IFS=,; echo "${NAMES[*]}")
  concurrently --restart-tries -1 --names "$NAMES_STR" --prefix-colors "blue,yellow,magenta,cyan" "${COMMANDS[@]}"
fi
