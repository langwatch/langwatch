#!/bin/bash
# Development environment launcher.
#
# Usage:
#   scripts/dev.sh                # interactive preset picker
#   scripts/dev.sh all-local      # local CH+PG+Redis+app, no NLP
#   scripts/dev.sh all-local-nlp  # all-local + langwatch_nlp + langevals
#   scripts/dev.sh dev-storage    # local CH+PG+Redis, stored-objects -> dev S3
#   scripts/dev.sh dev-infra      # local redis + workers + app, everything else against shared dev
#   scripts/dev.sh frontend-only  # no compose, pure pnpm dev against .env URLs
#   scripts/dev.sh migration      # postgres + clickhouse on host ports for prisma migrate
#   scripts/dev.sh full-local     # all-local-nlp + workers + bullboard + ai-server
#   scripts/dev.sh help           # non-interactive preset reference
#   scripts/dev.sh down           # stop all services
#   scripts/dev.sh ps | logs | clean | rebuild
set -e

COMPOSE="docker compose -f compose.dev.yml"
COMPOSE_MIGRATION="docker compose -f compose.dev.yml -f compose.dev.migration.yml"

# ---------------------------------------------------------------------------
# Help — non-interactive reference
# ---------------------------------------------------------------------------
if [ "${1:-}" = "help" ]; then
  cat <<'EOF'
LangWatch dev environment

Presets — pass as the first arg or pick interactively:

  all-local       Local postgres + redis + clickhouse + app + workers.
                  No NLP. Stored-objects fall back to local-FS. Fast iteration
                  default.

  all-local-nlp   all-local + langwatch_nlp + langevals containers.

  dev-storage     Local CH + PG + Redis + workers. Stored-objects route to the
                  dev S3 bucket runtime-storage-dev in lw-dev (eu-central-1).
                  Real AWS S3 driver under test without polluting shared dev
                  tables. Requires fresh AWS SSO credentials in langwatch/.env
                  — run `bash langwatch/scripts/refresh-dev-s3-env.sh` first
                  if S3_SESSION_TOKEN is missing or stale.

  dev-infra       Local app + local Redis + local workers container.
                  Postgres, ClickHouse, NLP, and S3 stay remote (shared dev
                  infrastructure). Redis and the `workers` compose service
                  are brought up so BullMQ jobs / GroupQueue streams stay
                  isolated to this operator and background processing
                  matches production's container layout. App still runs via
                  `pnpm dev` on the host for hot-reload. Most faithful e2e
                  short of running prod. WARNING: other developers see your
                  data in dev CH / dev PG.

  frontend-only   No compose. Pure `pnpm dev` against the URLs in your
                  langwatch/.env. UI / design / static iteration. Workers
                  still run in-process via `pnpm dev`; set
                  START_WORKERS=false on the command line if you want pure
                  Vite with no background processing.

  migration       postgres + clickhouse on HOST ports (5432 / 8123). Run
                  `pnpm prisma migrate dev` and `pnpm clickhouse:migrate`
                  from your host shell. No app, no workers.

  full-local      Kitchen-sink local: all-local-nlp + dedicated workers
                  container + bullboard + ai-server. Slowest boot.

URL-override model: each preset writes `langwatch/.env.dev-up` listing only
the URLs whose services start locally. compose loads this overlay AFTER
langwatch/.env (your source of truth), so non-overridden URLs keep their
.env values. CREDENTIALS NEVER GO IN THE OVERLAY — only non-rotating
infra shape (bucket/endpoint/region/connection-host).

Stateful volumes (langwatch-db-data, langwatch-clickhouse-data,
langwatch-redis-data) are shared across worktrees — sign up once, persist
across worktree switches. Only one worktree can have a given stateful
container `up` at a time; quickstart fails fast on collision.

Other actions:
  down / logs / ps / clean / rebuild   meta operations on the running stack
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Auto-detect worktree for container/volume isolation.
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

LAST_CHOICE_FILE="/tmp/.langwatch-dev-last-choice-v4-${COMPOSE_PROJECT_NAME:-langwatch}"

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
    echo "WARNING: langwatch_nlp/.env not found (needed for all-local-nlp / full-local presets)"
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

# Fail-fast on insecure SaaS-mode config.
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

# Detect cross-worktree collision on shared stateful volumes.
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
check_host_redis_collision() {
  [ "${SKIP_HOST_REDIS_CHECK:-0}" = "1" ] && return 0
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

# When a preset routes stored-objects to dev S3, the operator's .env must
# carry fresh AWS SSO credentials (S3_SESSION_TOKEN). Auto-run the
# refresh script if missing — it's interactive (opens SSO in a browser)
# but the alternative is failing with a hint that the operator then
# manually executes, which is more friction for the common case.
# Skip with QUICKSTART_NO_REFRESH=1 if you want to manage creds manually
# (e.g. you've pasted in an IAM-user access key instead of using SSO).
check_dev_s3_credentials() {
  if [ ! -f "langwatch/.env" ]; then
    return 0
  fi
  local has_token
  has_token=$(grep -E "^S3_SESSION_TOKEN[[:space:]]*=[[:space:]]*['\"]?.+['\"]?[[:space:]]*$" langwatch/.env || true)
  if [ -n "$has_token" ]; then
    return 0
  fi

  if [ "${QUICKSTART_NO_REFRESH:-0}" = "1" ]; then
    cat >&2 <<'EOF'
ERROR: dev-storage requires S3_SESSION_TOKEN in langwatch/.env but
       QUICKSTART_NO_REFRESH=1 was set. Set the credentials manually
       (e.g. an IAM user's access key) or unset QUICKSTART_NO_REFRESH
       and let the launcher rotate SSO creds for you.
EOF
    exit 1
  fi

  echo "No S3_SESSION_TOKEN in langwatch/.env — auto-refreshing AWS SSO credentials..."
  if ! bash langwatch/scripts/refresh-dev-s3-env.sh; then
    cat >&2 <<'EOF'
ERROR: refresh-dev-s3-env.sh failed. Inspect the output above. Common causes:
  - lw-dev-sso profile not configured (~/.aws/config)
  - aws CLI not installed
  - SSO browser flow declined / timed out
EOF
    exit 1
  fi
  echo "Credentials refreshed; continuing with dev-storage."
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
# URL overrides per preset. Delegates to scripts/lib/write-dev-overrides.sh.
# ---------------------------------------------------------------------------
. "$(dirname "$0")/lib/write-dev-overrides.sh"

write_overrides() {
  local preset="$1"
  local out="langwatch/.env.dev-up"
  write_dev_overrides "$preset" "$out"
  if [ -s "$out" ]; then
    echo "URL overrides for preset=$preset written to $out:"
    sed 's/^/  /' "$out" >&2
  else
    echo "No URL overrides for preset=$preset — your langwatch/.env values are used as-is."
  fi
}

# ---------------------------------------------------------------------------
# Free-port detection
# ---------------------------------------------------------------------------
find_free_port() {
  local port=$1
  while lsof -i :$port >/dev/null 2>&1 || docker ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:${port}->"; do
    port=$((port + 1))
  done
  echo $port
}

# ---------------------------------------------------------------------------
# Preset runners
# ---------------------------------------------------------------------------

run_all_local() {
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides all-local
  echo "Starting: postgres + redis + clickhouse + app + workers (preset=all-local)"
  $COMPOSE --profile workers up
}

run_all_local_nlp() {
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  export BULLBOARD_PORT=$(find_free_port 6380)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides all-local-nlp
  echo "Starting: backend + workers + langwatch_nlp + langevals (preset=all-local-nlp)"
  # `nlp` profile starts NLP/langevals; `workers` profile starts the worker
  # container. Both profiles must be passed — compose unions them.
  $COMPOSE --profile nlp --profile workers up
}

run_dev_storage() {
  check_dev_s3_credentials
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides dev-storage
  echo "Starting: postgres + redis + clickhouse + app + workers (preset=dev-storage)"
  echo "  Stored-objects route to s3://runtime-storage-dev/ via SSO credentials in langwatch/.env"
  $COMPOSE --profile workers up
}

run_dev_infra() {
  # Local app + local Redis + local workers compose + remote everything else.
  # Redis runs locally so BullMQ queues / GroupQueue streams / the fold cache
  # stay isolated to this operator (using shared dev Redis would collide with
  # other developers' jobs). The `workers` compose service runs alongside so
  # background jobs match production layout instead of relying on the host
  # `pnpm dev` in-process worker. DB / CH / NLP / S3 all stay remote per the
  # operator's .env. Warn loudly first — operators routinely write into
  # shared dev tables when running this.
  cat <<'EOF'

╔════════════════════════════════════════════════════════════╗
║              dev-infra preset                              ║
╠════════════════════════════════════════════════════════════╣
║  Local app + local Redis + local workers. Postgres,        ║
║  ClickHouse, NLP, and S3 route against shared dev          ║
║  infrastructure. Other developers will see your data in    ║
║  dev CH and dev Postgres. Test scenarios you run will      ║
║  appear in dev observability boards.                       ║
║                                                            ║
║  Use a recognizable identifier in scenario/test names so   ║
║  others can filter them out.                               ║
╚════════════════════════════════════════════════════════════╝

EOF
  read -p "Continue? [y/N]: " confirm
  case "$confirm" in
    [yY]|[yY]es) ;;
    *) exit 1 ;;
  esac
  check_dev_s3_credentials
  ensure_prepared
  write_overrides dev-infra
  echo "Starting: redis + workers compose services (preset=dev-infra)"
  echo "  App runs via 'pnpm dev' from langwatch/ on the host for hot-reload."
  echo "  Workers run in the compose 'workers' container (not in-process)."
  echo "  DB / ClickHouse / NLP / S3 come from langwatch/.env (shared dev)."
  $COMPOSE --profile workers up -d redis workers
  cat <<'EOF'

Redis is running detached on localhost:6379.
Workers compose container is running detached. Next:

  cd langwatch
  pnpm dev

Stop redis + workers with: scripts/dev.sh down
EOF
}

run_frontend_only() {
  write_overrides frontend-only
  echo "Preset: frontend-only — no compose. Run 'pnpm dev' from langwatch/ to start."
  echo ""
  echo "Tip: pure UI / design / static iteration. URLs come from langwatch/.env."
  echo "     For services on top: switch to all-local, all-local-nlp, or full-local."
}

run_migration() {
  SKIP_HOST_REDIS_CHECK=1 ensure_prepared
  write_overrides migration
  echo "Starting: postgres + clickhouse with HOST ports (preset=migration)"
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

run_full_local() {
  ensure_prepared
  export APP_PORT=$(find_free_port 5560)
  export BULLBOARD_PORT=$(find_free_port 6380)
  export AI_SERVER_PORT=$(find_free_port 3456)
  . "$(dirname "$0")/lib/sanitize-dev-env.sh"
  sanitize_localhost_dev_env
  write_overrides full-local
  echo "Starting: --profile full (preset=full-local)"
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
      local last_preset=""
      [ -f "$LAST_CHOICE_FILE" ] && last_preset=$(cat "$LAST_CHOICE_FILE")
      if [ -n "$last_preset" ] && [ "$last_preset" != "rebuild" ]; then
        echo "Restarting with last preset: $last_preset"
        exec "$0" "$last_preset"
      else
        echo "No prior preset remembered — run a preset (e.g. 'scripts/dev.sh all-local') to start."
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

# If sourced (e.g. by bats tests), expose functions and stop here.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0
fi

# Non-interactive: preset name as first arg.
if [ -n "${1:-}" ]; then
  case "$1" in
    all-local)                     run_all_local ;;
    all-local-nlp)                 run_all_local_nlp ;;
    dev-storage)                   run_dev_storage ;;
    dev-infra)                     run_dev_infra ;;
    frontend-only|frontend)        run_frontend_only ;;
    migration|migrations)          run_migration ;;
    full-local|full)               run_full_local ;;
    down|logs|ps|clean|rebuild)    run_meta "$1" ;;
    *)
      echo "Unknown preset: $1" >&2
      echo "Run 'scripts/dev.sh help' for the preset list." >&2
      exit 1
      ;;
  esac
  exit 0
fi

# Interactive prompt.
LAST=""
[ -f "$LAST_CHOICE_FILE" ] && LAST=$(cat "$LAST_CHOICE_FILE")

cat <<'EOF'

╔════════════════════════════════════════════════════════════╗
║              LangWatch Development Environment             ║
╚════════════════════════════════════════════════════════════╝

Pick a preset:

  1) all-local       Local CH + PG + Redis + app + workers. No NLP. Fast iteration.
  2) all-local-nlp   all-local + langwatch_nlp + langevals.
  3) dev-storage     Local DBs + workers, stored-objects -> runtime-storage-dev (real AWS S3).
  4) dev-infra       Local app + Redis + workers, shared dev infra for PG/CH/NLP/S3. Most faithful e2e.
  5) frontend-only   No compose. UI / design / static iteration.
  6) migration       postgres + clickhouse on host ports for prisma migrate (no app, no workers).
  7) full-local      Kitchen-sink local: all-local-nlp + dedicated workers container + bullboard + ai-server.

  d) down            stop all services
  l) logs            tail compose logs
  p) ps              show running services
  c) clean           stop + remove ALL data (shared volumes too)
  r) rebuild         remove container node_modules + restart
  q) quit

EOF
if [ -n "$LAST" ]; then
  echo "Hit enter to repeat last: ${LAST}"
else
  echo "Hit enter for all-local (the default)."
fi
echo ""

read -p "Choice [1-7/d/l/p/c/r/q]: " choice
if [ -z "$choice" ]; then
  if [ -n "$LAST" ]; then
    choice="$LAST"
  else
    choice="all-local"
  fi
fi

case "$choice" in
  1|all-local)         echo "all-local" > "$LAST_CHOICE_FILE"; run_all_local ;;
  2|all-local-nlp)     echo "all-local-nlp" > "$LAST_CHOICE_FILE"; run_all_local_nlp ;;
  3|dev-storage)       echo "dev-storage" > "$LAST_CHOICE_FILE"; run_dev_storage ;;
  4|dev-infra)         echo "dev-infra" > "$LAST_CHOICE_FILE"; run_dev_infra ;;
  5|frontend-only|frontend)
                       echo "frontend-only" > "$LAST_CHOICE_FILE"; run_frontend_only ;;
  6|migration|migrations)
                       echo "migration" > "$LAST_CHOICE_FILE"; run_migration ;;
  7|full-local|full)   echo "full-local" > "$LAST_CHOICE_FILE"; run_full_local ;;
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
