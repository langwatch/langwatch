#!/bin/bash
# Development environment launcher (single entry point — #3860 AC#1).
#
# Usage:
#   scripts/dev.sh                # interactive mode picker
#   scripts/dev.sh frontend-only  # no compose, pure pnpm dev against .env URLs
#   scripts/dev.sh backend-shared # postgres + redis + clickhouse + app, URLs → local
#   scripts/dev.sh migration      # postgres + clickhouse on host ports, run migrations from host
#   scripts/dev.sh nlp            # backend + nlp + langevals; nlp/langevals URLs → local
#   scripts/dev.sh full-local     # --profile full; all infrastructure URLs → local
#   scripts/dev.sh help           # non-interactive mode reference
#   scripts/dev.sh down           # stop all services
#   scripts/dev.sh ps | logs | clean | rebuild
set -e

COMPOSE="docker compose -f compose.dev.yml"
COMPOSE_MIGRATION="docker compose -f compose.dev.yml -f compose.dev.migration.yml"

# ---------------------------------------------------------------------------
# Help mode (#3860 AC#8) — non-interactive reference
# ---------------------------------------------------------------------------
if [ "${1:-}" = "help" ]; then
  cat <<'EOF'
LangWatch dev environment

Modes — pass as the first arg or pick interactively:

  frontend-only   No compose. Pure `pnpm dev` against the URLs in your
                  langwatch/.env. Fastest — for UI / design / static iteration.
                  (default — hit enter at the prompt)

  backend-shared  Local postgres + redis + clickhouse + app. Overrides
                  DATABASE_URL, REDIS_URL, CLICKHOUSE_URL → local containers.
                  Other URLs come from your .env unchanged.

  migration       postgres + clickhouse on HOST ports (5432 / 8123). Run
                  `pnpm prisma migrate dev` and `pnpm clickhouse:migrate`
                  from your host shell. Overrides DATABASE_URL, CLICKHOUSE_URL.

  nlp             backend + langwatch_nlp + langevals. Overrides
                  DATABASE_URL, REDIS_URL, CLICKHOUSE_URL, LANGWATCH_NLP_SERVICE,
                  LANGEVALS_ENDPOINT → local containers.

  full-local      --profile full (everything: workers, scenarios, bullboard,
                  ai-server, nlp). Overrides every infrastructure URL → local.

URL-override model: each mode writes `langwatch/.env.dev-up` listing only
the URLs whose services are starting locally for that mode. compose loads
this overlay AFTER langwatch/.env (your source of truth), so non-overridden
URLs keep their .env values (#3860 AC#2 / AC#6).

Stateful volumes (langwatch-db-data, langwatch-clickhouse-data,
langwatch-redis-data) are shared across worktrees — sign up once, persist
across worktree switches. Only one worktree can have a given stateful
container `up` at a time; quickstart fails fast on collision.

Stateless redis exposes host :6379.

Other actions:
  down / logs / ps / clean / rebuild   meta operations on the running stack
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Auto-detect worktree for container/volume isolation. Stateful volumes
# (langwatch-db-data etc.) are stable shared names regardless of project
# (#3860 AC#4); per-worktree node_modules still need the prefix.
# ---------------------------------------------------------------------------
if git rev-parse --is-inside-work-tree &>/dev/null; then
  WORKTREE_NAME=$(basename "$(git rev-parse --show-toplevel)")
  if [ "$WORKTREE_NAME" != "langwatch" ]; then
    WORKTREE_NAME=$(echo "$WORKTREE_NAME" \
      | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')
    [ -z "$WORKTREE_NAME" ] && WORKTREE_NAME="langwatch"
    export COMPOSE_PROJECT_NAME="${WORKTREE_NAME}"
    export VOLUME_PREFIX="${WORKTREE_NAME}"
  fi
fi

LAST_CHOICE_FILE="/tmp/.langwatch-dev-last-choice-v3-${COMPOSE_PROJECT_NAME:-langwatch}"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

check_env_files() {
  local missing=0
  if [ ! -f "langwatch/.env" ]; then
    echo "WARNING: langwatch/.env not found"
    echo "  → cp langwatch/.env.example langwatch/.env"
    missing=1
  fi
  if [ ! -f "langwatch_nlp/.env" ]; then
    echo "WARNING: langwatch_nlp/.env not found (needed for nlp / full-local modes)"
    echo "  → cp langwatch_nlp/.env.example langwatch_nlp/.env"
    missing=1
  fi
  if [ $missing -eq 1 ]; then
    echo ""
    read -p "Continue anyway? [y/N]: " confirm
    case "$confirm" in
      [yY]|[yY]es) ;;
      *) exit 1 ;;
    esac
  fi
}

# Fail-fast on insecure SaaS-mode config (#3860 AC#7).
# Patterns accept unquoted, single-quoted, and double-quoted values — all
# valid `.env` syntax.
#
# The app code reads `BLOCK_LOCAL_HTTP_CALLS` as `!!env.BLOCK_LOCAL_HTTP_CALLS`,
# i.e. truthy / falsy in JS terms — absence and explicit `false` both
# disable SSRF blocking. So with `IS_SAAS=true`, we need the var present AND
# set to a truthy value (true / 1 / yes), not just "not literally false".
check_saas_ssrf_guard() {
  if [ ! -f "langwatch/.env" ]; then return 0; fi
  if ! grep -qE "^IS_SAAS[[:space:]]*=[[:space:]]*['\"]?true['\"]?[[:space:]]*$" langwatch/.env; then
    return 0
  fi
  if ! grep -qE "^BLOCK_LOCAL_HTTP_CALLS[[:space:]]*=[[:space:]]*['\"]?(true|1|yes)['\"]?[[:space:]]*$" langwatch/.env; then
    cat >&2 <<'EOF'
ERROR: langwatch/.env has IS_SAAS=true but BLOCK_LOCAL_HTTP_CALLS is not
       explicitly set to a truthy value. SaaS mode requires SSRF blocking;
       absence of the variable counts as disabled. Add:
         BLOCK_LOCAL_HTTP_CALLS=true
EOF
    exit 1
  fi
}

# Detect cross-worktree collision on shared stateful volumes (#3860 AC#4).
# Includes redis even though it's a singleton — a second worktree's compose
# project would still try to start its own redis container against the
# shared volume and fail with a less-helpful binding error.
check_stateful_collision() {
  local me="${COMPOSE_PROJECT_NAME:-langwatch}"
  local vol cid project
  for vol in langwatch-db-data langwatch-clickhouse-data langwatch-redis-data; do
    for cid in $(docker ps -q --filter "volume=$vol" 2>/dev/null); do
      project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$cid" 2>/dev/null || true)
      if [ -n "$project" ] && [ "$project" != "$me" ]; then
        cat >&2 <<EOF
ERROR: Shared volume '$vol' is already in use by compose project '$project'.
       Only one worktree can run postgres / clickhouse / redis at a time.
       Stop the other one first:
         (cd that worktree && make down)
EOF
        exit 1
      fi
    done
  done
}

# Detect a host-side process holding port 6379 before redis tries to bind.
# Compose's own error is `Error response from daemon: ports are not available`,
# which sends contributors hunting through compose for a problem that's
# actually `redis-server` running on the host. Only fires when we're about
# to start the redis container (skipped in frontend-only mode where the
# caller passes SKIP_HOST_REDIS_CHECK=1).
check_host_redis_collision() {
  [ "${SKIP_HOST_REDIS_CHECK:-0}" = "1" ] && return 0
  # ss is in iproute2, present on every modern Linux + WSL; lsof on macOS.
  local pid=""
  if command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -iTCP:6379 -sTCP:LISTEN -t 2>/dev/null | head -n1)
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :6379" 2>/dev/null | grep -q ":6379" && pid="<unknown>"
  fi
  [ -z "$pid" ] && return 0
  cat >&2 <<EOF
ERROR: A process is already listening on host port 6379 (redis).
       The dev-stack redis container needs that port to bind. Stop the
       host-side redis first (e.g. 'brew services stop redis' on macOS,
       'sudo systemctl stop redis-server' on Linux), or set
       SKIP_HOST_REDIS_CHECK=1 if you've intentionally repointed the dev
       stack at a host redis.
EOF
  exit 1
}

ensure_prepared() {
  check_env_files
  check_saas_ssrf_guard
  check_stateful_collision
  check_host_redis_collision
  ( cd langwatch
    if [ ! -d node_modules ]; then
      echo "Installing host dependencies (for prep)..."
      pnpm install
    fi
    echo "Preparing files..."
    pnpm run start:prepare:files
  )
}

# ---------------------------------------------------------------------------
# URL overrides per mode (#3860 AC#2 / AC#6).
# Delegates to scripts/lib/write-dev-overrides.sh — same helper is sourced by
# scripts/dev-up.sh so the two launchers can't drift on the overlay format.
# ---------------------------------------------------------------------------
. "$(dirname "$0")/lib/write-dev-overrides.sh"

write_overrides() {
  local mode="$1"
  local out="langwatch/.env.dev-up"
  write_dev_overrides "$mode" "$out"
  if [ -s "$out" ]; then
    echo "URL overrides for mode=$mode written to $out:"
    sed 's/^/  /' "$out" >&2
  else
    echo "No URL overrides for mode=$mode — your langwatch/.env values are used as-is."
  fi
}

# ---------------------------------------------------------------------------
# Free-port detection (used in non-frontend modes for app/bullboard/ai-server)
# ---------------------------------------------------------------------------
find_free_port() {
  local port=$1
  while lsof -i :$port >/dev/null 2>&1 || docker ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:${port}->"; do
    port=$((port + 1))
  done
  echo $port
}

# ---------------------------------------------------------------------------
# Mode runners
# ---------------------------------------------------------------------------

run_frontend_only() {
  echo "Mode: frontend-only — no compose. Run 'pnpm dev' from langwatch/ to start."
  write_overrides frontend-only
  echo ""
  echo "Tip: pure UI / design / static iteration. URLs come from langwatch/.env."
  echo "     For services on top: switch to backend-shared, nlp, or full-local."
}

run_backend_shared() {
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides backend-shared
  echo "Starting: postgres + redis + clickhouse + app (mode=backend-shared)"
  $COMPOSE up
}

run_migration() {
  # Use the same prep path as backend-shared / nlp / full-local so a fresh
  # clone running migration as its first mode still has node_modules and
  # the generated Prisma client available for the host-side
  # `pnpm prisma migrate dev` call below. Migration mode only starts
  # postgres + clickhouse — redis isn't bound to :6379 here, so a
  # host-side redis is irrelevant; skip that collision check.
  SKIP_HOST_REDIS_CHECK=1 ensure_prepared
  write_overrides migration
  echo "Starting: postgres + clickhouse with HOST ports (mode=migration)"
  $COMPOSE_MIGRATION up -d postgres clickhouse
  cat <<EOF

Postgres: localhost:5432  Clickhouse: localhost:8123
DATABASE_URL and CLICKHOUSE_URL pinned to localhost in langwatch/.env.dev-up.

Run migrations from your host shell:

  cd langwatch
  pnpm prisma migrate dev          # for postgres schema changes
  pnpm clickhouse:migrate           # for clickhouse schema changes

Stop with: scripts/dev.sh down
EOF
}

run_nlp() {
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  export BULLBOARD_PORT=$(find_free_port 6380)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides nlp
  echo "Starting: backend + langwatch_nlp + langevals (mode=nlp)"
  $COMPOSE --profile nlp up
}

run_full_local() {
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  export BULLBOARD_PORT=$(find_free_port 6380)
  export AI_SERVER_PORT=$(find_free_port 3456)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides full-local
  echo "Starting: --profile full (mode=full-local)"
  $COMPOSE --profile full up
}

run_meta() {
  case "$1" in
    down|d|D)
      echo "Stopping all services..."
      $COMPOSE --profile full down
      ;;
    logs|l|L)
      echo "Tailing logs..."
      $COMPOSE --profile full logs -f
      ;;
    ps|p|P)
      $COMPOSE --profile full ps
      ;;
    clean|c|C)
      read -p "This will delete shared volumes (postgres, clickhouse, redis data + per-worktree node_modules). Are you sure? [y/N]: " confirm
      if [[ $confirm =~ ^[Yy]$ ]]; then
        echo "Stopping and removing volumes..."
        $COMPOSE --profile full down -v
        echo "Done. Next start will be fresh."
      else
        echo "Cancelled."
      fi
      ;;
    rebuild|r|R)
      echo "Rebuilding (removes container node_modules)..."
      $COMPOSE --profile full down
      docker volume rm "${VOLUME_PREFIX:-langwatch}-app-modules" 2>/dev/null || true
      docker volume rm "${VOLUME_PREFIX:-langwatch}-bullboard-modules" 2>/dev/null || true
      docker volume rm "${VOLUME_PREFIX:-langwatch}-goose-bin" 2>/dev/null || true
      # The menu text promises a restart after the rebuild — honor that by
      # re-execing with the last selected mode. Falls back to the
      # interactive prompt when no prior mode is remembered.
      local last_mode=""
      [ -f "$LAST_CHOICE_FILE" ] && last_mode=$(cat "$LAST_CHOICE_FILE")
      if [ -n "$last_mode" ] && [ "$last_mode" != "rebuild" ]; then
        echo "Restarting with last mode: $last_mode"
        exec "$0" "$last_mode"
      else
        echo "No prior mode remembered — run a mode (e.g. 'scripts/dev.sh backend-shared') to start."
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

# If sourced (e.g. by bats tests), expose functions and stop here. Keeps the
# helpers unit-testable without running the prompt.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0
fi

# If a mode arg is provided, run it non-interactively.
if [ -n "${1:-}" ]; then
  case "$1" in
    frontend-only|frontend)        run_frontend_only ;;
    backend-shared|backend)        run_backend_shared ;;
    migration|migrations)          run_migration ;;
    nlp)                           run_nlp ;;
    full-local|full)               run_full_local ;;
    down|logs|ps|clean|rebuild)    run_meta "$1" ;;
    *)
      echo "Unknown mode: $1" >&2
      echo "Run 'scripts/dev.sh help' for the mode list." >&2
      exit 1
      ;;
  esac
  exit 0
fi

# Otherwise interactive prompt.
LAST=""
[ -f "$LAST_CHOICE_FILE" ] && LAST=$(cat "$LAST_CHOICE_FILE")

cat <<'EOF'

╔════════════════════════════════════════════════════════════╗
║              LangWatch Development Environment             ║
╚════════════════════════════════════════════════════════════╝

What are you working on?

  1) frontend-only    UI / design — no compose, fastest. URLs from .env.
  2) backend-shared   postgres + redis + clickhouse + app, URLs → local.
  3) migration        postgres + clickhouse on host ports for prisma migrate.
  4) nlp              backend + langwatch_nlp + langevals, all URLs → local.
  5) full-local       --profile full (workers, bullboard, ai-server, …).

  d) down             stop all services
  l) logs             tail compose logs
  p) ps               show running services
  c) clean            stop + remove ALL data (shared volumes too)
  r) rebuild          remove container node_modules + restart
  q) quit

EOF
if [ -n "$LAST" ]; then
  echo "Hit enter to repeat last: ${LAST}"
else
  echo "Hit enter for frontend-only (the default)."
fi
echo ""

read -p "Choice [1-5/d/l/p/c/r/q]: " choice
# Enter selects the saved choice if present, else the documented default.
if [ -z "$choice" ]; then
  if [ -n "$LAST" ]; then
    choice="$LAST"
  else
    choice="frontend-only"
  fi
fi

case "$choice" in
  1|frontend-only|frontend)
    echo "frontend-only" > "$LAST_CHOICE_FILE"; run_frontend_only ;;
  2|backend-shared|backend)
    echo "backend-shared" > "$LAST_CHOICE_FILE"; run_backend_shared ;;
  3|migration|migrations)
    echo "migration" > "$LAST_CHOICE_FILE"; run_migration ;;
  4|nlp)
    echo "nlp" > "$LAST_CHOICE_FILE"; run_nlp ;;
  5|full-local|full)
    echo "full-local" > "$LAST_CHOICE_FILE"; run_full_local ;;
  d|D|down)            run_meta down ;;
  l|L|logs)            run_meta logs ;;
  p|P|ps)              run_meta ps ;;
  c|C|clean)           run_meta clean ;;
  r|R|rebuild)         run_meta rebuild
                       [ -n "$LAST" ] && exec "$0" "$LAST" ;;
  q|Q|quit)            echo "Bye!"; exit 0 ;;
  *)
    echo "Invalid choice: $choice" >&2
    exit 1
    ;;
esac
