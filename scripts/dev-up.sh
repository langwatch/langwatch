#!/bin/bash
# Non-interactive development environment launcher for AI agents.
# Starts services in detached mode, finds free ports, isolates volumes per worktree.
#
# Usage:
#   ./scripts/dev-up.sh [PROFILE]
#
# Profiles: dev (default), search, nlp, scenarios, test, full
#
# Outputs .dev-port with the assigned app port for agent discovery.
# Each worktree gets isolated containers and volumes (except pnpm cache).
set -e

PROFILE="${1:-}"
COMPOSE="docker compose -f compose.dev.yml"

# ---------------------------------------------------------------------------
# Derive a stable, unique prefix from the repo directory path.
# Two worktrees on the same machine will always get different prefixes.
# ---------------------------------------------------------------------------
DIR_HASH=$(echo -n "$PWD" | md5sum | cut -c1-8)
export VOLUME_PREFIX="lw-${DIR_HASH}"
export COMPOSE_PROJECT_NAME="langwatch-${DIR_HASH}"

# ---------------------------------------------------------------------------
# Find a free port starting from a base value.
# Checks both host processes (lsof) and Docker port bindings.
# ---------------------------------------------------------------------------
find_free_port() {
  local port=$1
  while lsof -i :"$port" >/dev/null 2>&1 || docker ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:${port}->"; do
    port=$((port + 1))
  done
  echo "$port"
}

export APP_PORT=$(find_free_port 5560)
export BULLBOARD_PORT=$(find_free_port 3000)
export AI_SERVER_PORT=$(find_free_port 3456)

# ---------------------------------------------------------------------------
# Ensure .env files exist
# ---------------------------------------------------------------------------
if [ ! -f "langwatch/.env" ] && [ -f "langwatch/.env.example" ]; then
  echo "Creating langwatch/.env from example..."
  cp langwatch/.env.example langwatch/.env
fi
if [ ! -f "langwatch_nlp/.env" ] && [ -f "langwatch_nlp/.env.example" ]; then
  echo "Creating langwatch_nlp/.env from example..."
  cp langwatch_nlp/.env.example langwatch_nlp/.env
fi

# ---------------------------------------------------------------------------
# Prepare host files (codegen, prisma, etc.)
# The source directory is mounted into Docker, so generated files must exist
# on the host before containers start.
# ---------------------------------------------------------------------------
echo "Preparing host files..."
(
  cd langwatch
  if [ ! -d node_modules ]; then
    echo "Installing host dependencies..."
    pnpm install
  fi
  pnpm run start:prepare:files 2>/dev/null || echo "WARNING: start:prepare:files had errors (non-fatal)"
)

# ---------------------------------------------------------------------------
# Build compose command with optional profile
# ---------------------------------------------------------------------------
COMPOSE_CMD="$COMPOSE"
if [ -n "$PROFILE" ] && [ "$PROFILE" != "dev" ]; then
  COMPOSE_CMD="$COMPOSE --profile $PROFILE"
fi

# ---------------------------------------------------------------------------
# Start services in detached mode
# ---------------------------------------------------------------------------
echo "Starting LangWatch (project=${COMPOSE_PROJECT_NAME}, app_port=${APP_PORT})..."
$COMPOSE_CMD up -d

# ---------------------------------------------------------------------------
# Save port info for agent/skill discovery
# ---------------------------------------------------------------------------
cat > .dev-port <<EOF
APP_PORT=${APP_PORT}
BULLBOARD_PORT=${BULLBOARD_PORT}
AI_SERVER_PORT=${AI_SERVER_PORT}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}
VOLUME_PREFIX=${VOLUME_PREFIX}
BASE_URL=http://localhost:${APP_PORT}
EOF

echo ""
echo "Services starting in background."
echo "  App:        http://localhost:${APP_PORT}"
echo "  Project:    ${COMPOSE_PROJECT_NAME}"
echo "  Port file:  .dev-port"
echo ""

# ---------------------------------------------------------------------------
# Wait for the app to become healthy (up to 5 minutes)
# ---------------------------------------------------------------------------
echo "Waiting for app to be ready..."
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  # Check for any HTTP response (connection accepted = app is up)
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}" 2>/dev/null || true)
  if [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" != "000" ]; then
    echo "App is ready (HTTP ${HTTP_CODE}) at http://localhost:${APP_PORT}"
    exit 0
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [ $((ELAPSED % 30)) -eq 0 ]; then
    echo "  Still waiting... (${ELAPSED}s / ${TIMEOUT}s)"
  fi
done

echo "WARNING: App did not respond within ${TIMEOUT}s. Check logs with: make dev-logs"
echo "  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} VOLUME_PREFIX=${VOLUME_PREFIX} docker compose -f compose.dev.yml logs -f app"
exit 1
