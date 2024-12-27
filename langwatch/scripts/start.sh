#!/bin/sh

set -eo pipefail

RUNTIME_ENV="NODE_ENV=production DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true"

if grep -q "^ELASTICSEARCH_NODE_URL=\"\?quickwit://" .env || ([ -n "$ELASTICSEARCH_NODE_URL" ] && [[ "$ELASTICSEARCH_NODE_URL" =~ ^quickwit:// ]]); then
  if [ ! -d "quickwit" ]; then
    echo "Quickwit was not found, installing it..."
    npm run setup:quickwit
  fi

  NODE_ENV=production DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true RUST_LOG=warning concurrently --restart-tries -1 './scripts/wait-for-quickwit.sh && npm run start:prepare:db && npm run start:app' 'npm run start:workers' 'npm run start:quickwit'
else
  npm run start:prepare:db
  NODE_ENV=production DEBUG=langwatch:* DEBUG_HIDE_DATE=true DEBUG_COLORS=true concurrently --restart-tries -1 'npm run start:app' 'npm run start:workers'
fi
