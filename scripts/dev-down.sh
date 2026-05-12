#!/bin/bash
# Stop the development environment started by dev-up.sh.
# Reads .dev-port to find the correct project name and volumes.
#
# Usage:
#   ./scripts/dev-down.sh          # stop containers
#   ./scripts/dev-down.sh --clean  # stop and remove volumes
set -e

COMPOSE="docker compose -f compose.dev.yml"

# ---------------------------------------------------------------------------
# Restore isolation env vars from .dev-port
# ---------------------------------------------------------------------------
if [ -f .dev-port ]; then
  # shellcheck disable=SC1091
  source .dev-port
  export COMPOSE_PROJECT_NAME VOLUME_PREFIX
else
  # Fallback: derive from directory (same logic as dev-up.sh)
  DIR_HASH=$(echo -n "$PWD" | md5sum | cut -c1-8)
  export VOLUME_PREFIX="lw-${DIR_HASH}"
  export COMPOSE_PROJECT_NAME="langwatch-${DIR_HASH}"
fi

if [ "$1" = "--clean" ]; then
  echo "Stopping and removing volumes for ${COMPOSE_PROJECT_NAME}..."
  $COMPOSE --profile full down -v
else
  echo "Stopping ${COMPOSE_PROJECT_NAME}..."
  $COMPOSE --profile full down
fi

rm -f .dev-port
echo "Done."
