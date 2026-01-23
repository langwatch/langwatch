#!/bin/bash
# Interactive development environment launcher
set -e

COMPOSE="docker compose -f compose.dev.yml"
LAST_CHOICE_FILE="/tmp/.langwatch-dev-last-choice"

# Check for required .env files
check_env_files() {
  local missing=0
  if [ ! -f "langwatch/.env" ]; then
    echo "WARNING: langwatch/.env not found"
    echo "  → cp langwatch/.env.example langwatch/.env"
    missing=1
  fi
  if [ ! -f "langwatch_nlp/.env" ]; then
    echo "WARNING: langwatch_nlp/.env not found (needed for nlp/scenarios profiles)"
    echo "  → cp langwatch_nlp/.env.example langwatch_nlp/.env"
    missing=1
  fi
  if [ $missing -eq 1 ]; then
    echo ""
    read -p "Continue anyway? [y/N]: " confirm
    [[ ! $confirm =~ ^[Yy]$ ]] && exit 1
  fi
}

# Run prep steps on host (curl available, prisma generate needs node_modules)
ensure_prepared() {
  check_env_files
  cd langwatch
  # Host needs its own node_modules for prep (separate from container's Linux deps)
  if [ ! -d node_modules ]; then
    echo "Installing host dependencies (for prep)..."
    pnpm install
  fi
  # Prepare files (prisma generate, curl download, etc)
  echo "Preparing files..."
  pnpm run start:prepare:files 2>/dev/null || true
  cd ..
}

# Find a free port starting from base
find_free_port() {
  local port=$1
  while lsof -i :$port >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo $port
}

# Auto-detect free ports
export APP_PORT=$(find_free_port 5560)
export BULLBOARD_PORT=$(find_free_port 3000)
export AI_SERVER_PORT=$(find_free_port 3456)

# Load last choice if exists
LAST=""
if [ -f "$LAST_CHOICE_FILE" ]; then
  LAST=$(cat "$LAST_CHOICE_FILE")
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              LangWatch Development Environment             ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Ports: app=$APP_PORT  bullboard=$BULLBOARD_PORT  ai-server=$AI_SERVER_PORT"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
PROFILE_NAMES=("" "dev" "dev-search" "dev-nlp" "dev-scenarios" "dev-test" "dev-full")

echo "Select a profile:"
echo ""
echo "  1) dev           - Minimal (postgres, redis, app)"
echo "  2) dev-search    - + opensearch (for traces/search)"
echo "  3) dev-nlp       - + NLP + langevals (for evaluations)"
echo "  4) dev-scenarios - + scenario worker + bullboard + NLP"
echo "  5) dev-test      - + AI test server"
echo "  6) dev-full      - Everything"
echo ""
echo "  r) rebuild       - Rebuild (removes node_modules, restarts)"
echo "  d) down          - Stop all services"
echo "  l) logs          - Tail logs"
echo "  p) ps            - Show running services"
echo "  c) clean         - Stop and remove all data"
echo "  q) quit"
echo ""

if [ -n "$LAST" ]; then
  echo "Or just hit enter to use previous (${PROFILE_NAMES[$LAST]})"
  echo ""
fi
read -p "Choice: " choice
[ -z "$choice" ] && [ -n "$LAST" ] && choice="$LAST"

case $choice in
  1)
    echo "$choice" > "$LAST_CHOICE_FILE"
    ensure_prepared
    echo "Starting: postgres + redis + app..."
    $COMPOSE up
    ;;
  2)
    echo "$choice" > "$LAST_CHOICE_FILE"
    ensure_prepared
    echo "Starting: + opensearch..."
    $COMPOSE --profile search up
    ;;
  3)
    echo "$choice" > "$LAST_CHOICE_FILE"
    ensure_prepared
    echo "Starting: + nlp + langevals..."
    $COMPOSE --profile nlp up
    ;;
  4)
    echo "$choice" > "$LAST_CHOICE_FILE"
    ensure_prepared
    echo "Starting: scenarios (+ workers + bullboard + nlp)..."
    $COMPOSE --profile scenarios up
    ;;
  5)
    echo "$choice" > "$LAST_CHOICE_FILE"
    ensure_prepared
    echo "Starting: + ai-server..."
    $COMPOSE --profile test up
    ;;
  6)
    echo "$choice" > "$LAST_CHOICE_FILE"
    ensure_prepared
    echo "Starting: full stack..."
    $COMPOSE --profile full up
    ;;
  r|R)
    echo "Rebuilding (removes container node_modules)..."
    $COMPOSE --profile full down
    docker volume rm "${PWD##*/}_app_modules" 2>/dev/null || true
    # Re-run with last profile
    if [ -n "$LAST" ]; then
      echo "Restarting with last profile..."
      exec "$0"
    else
      echo "Done. Run quickstart again to start."
    fi
    ;;
  d|D)
    echo "Stopping all services..."
    $COMPOSE --profile full down
    ;;
  l|L)
    echo "Tailing logs..."
    $COMPOSE --profile full logs -f
    ;;
  p|P)
    $COMPOSE --profile full ps
    ;;
  c|C)
    read -p "This will delete all data. Are you sure? [y/N]: " confirm
    if [[ $confirm =~ ^[Yy]$ ]]; then
      echo "Stopping and removing volumes..."
      $COMPOSE --profile full down -v
      echo "Done. Next start will be fresh."
    else
      echo "Cancelled."
    fi
    ;;
  q|Q)
    echo "Bye!"
    exit 0
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac
