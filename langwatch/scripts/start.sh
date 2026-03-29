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

wait_for_postgres() {
  if [ -n "$DATABASE_URL" ]; then
    echo "Waiting for database to be ready..."
    db_ready=false
    for i in $(seq 1 30); do
      if node -e "
        const url = new URL(process.env.DATABASE_URL.replace('postgresql://', 'http://'));
        const net = require('net');
        const s = net.connect({host: url.hostname, port: url.port || 5432}, () => { s.end(); process.exit(0); });
        s.on('error', () => process.exit(1));
        setTimeout(() => process.exit(1), 2000);
      " 2>/dev/null; then
        echo "Database is reachable"
        db_ready=true
        break
      fi
      echo "Database not ready yet, retrying in 2s... ($i/30)"
      sleep 2
    done
    if [ "$db_ready" != "true" ]; then
      echo "Database was not reachable after 30 attempts; aborting startup."
      exit 1
    fi
  fi
}

START_QUICKWIT_COMMAND=""
if grep -q "^ELASTICSEARCH_NODE_URL=\"\?quickwit://" .env || ([ -n "$ELASTICSEARCH_NODE_URL" ] && [[ "$ELASTICSEARCH_NODE_URL" =~ ^quickwit:// ]]); then
  wait_for_postgres
  START_QUICKWIT_COMMAND="pnpm run start:quickwit"
  START_APP_COMMAND="./scripts/wait-for-quickwit.sh && pnpm run start:prepare:db && pnpm run start:app"
  RUNTIME_ENV="$RUNTIME_ENV RUST_LOG=error"

  if [ ! -d "quickwit" ]; then
    echo "Quickwit was not found, installing it..."
    pnpm run setup:quickwit
  fi
else
  wait_for_postgres
  pnpm run start:prepare:db
fi

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
if [ -n "$START_QUICKWIT_COMMAND" ]; then
  COMMANDS+=("$RUNTIME_ENV $START_QUICKWIT_COMMAND")
  NAMES+=("quickwit")
fi

# If only one command, exec directly to preserve JSON log format
# (concurrently adds prefixes that break JSON parsing)
if [ ${#COMMANDS[@]} -eq 1 ]; then
  eval "$RUNTIME_ENV exec $START_APP_COMMAND"
else
  NAMES_STR=$(IFS=,; echo "${NAMES[*]}")
  concurrently --restart-tries -1 --names "$NAMES_STR" --prefix-colors "blue,yellow,magenta,cyan" "${COMMANDS[@]}"
fi