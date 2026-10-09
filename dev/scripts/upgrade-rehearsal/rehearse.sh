#!/usr/bin/env bash
# Rehearses the upgrade from an old image to head over shared stores (plan 2026-10-08, section F,
# phases 0 to 2) and writes <run-dir>/report.md and report.json. README.md beside this file
# has the operator's commands. Exit 2 is a usage error, 3 a host that cannot run compose.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
EXIT_USAGE=2
EXIT_ENVIRONMENT=3

ORIGIN="3.20.1"
OLD_IMAGE=""
HEAD_IMAGE=""
BUILD_MAIN=0
BUILD_HEAD=0
ORDER="api-first"
SETTLE_SECONDS=300
DRILL_SECONDS=120
SEED_TRACES=200
SEED_PER_KIND=1
RUN_DIR=""
KEEP=0
PLAN_ONLY=0
THROUGH=5
SCALE=0
SCALE_PROJECTS=20000
SCALE_USERS=200000
BOUNDS=""

usage() {
  cat <<'EOF'
usage: rehearse.sh [--origin 3.20.1|main|empty] [--old-image IMAGE | --build-main]
                   [--head-image IMAGE | --build-head] [--order api-first|worker-first]
                   [--settle-seconds N] [--drill-seconds N] [--seed-traces N] [--seed-per-kind N]
                   [--through 2|3|4|5] [--scale [--scale-projects N] [--scale-users N]]
                   [--bounds FILE] [--run-dir DIR] [--keep] [--plan-only]
EOF
}

die_usage() {
  echo "rehearse: $1" >&2
  usage >&2
  exit "$EXIT_USAGE"
}

parse_args() {
  while (($#)); do
    case "$1" in
      --origin) ORIGIN="${2:?}"; shift 2 ;;
      --old-image) OLD_IMAGE="${2:?}"; shift 2 ;;
      --head-image) HEAD_IMAGE="${2:?}"; shift 2 ;;
      --build-main) BUILD_MAIN=1; shift ;;
      --build-head) BUILD_HEAD=1; shift ;;
      --order) ORDER="${2:?}"; shift 2 ;;
      --settle-seconds) SETTLE_SECONDS="${2:?}"; shift 2 ;;
      --drill-seconds) DRILL_SECONDS="${2:?}"; shift 2 ;;
      --seed-traces) SEED_TRACES="${2:?}"; shift 2 ;;
      --seed-per-kind) SEED_PER_KIND="${2:?}"; shift 2 ;;
      --run-dir) RUN_DIR="${2:?}"; shift 2 ;;
      --keep) KEEP=1; shift ;;
      --plan-only) PLAN_ONLY=1; shift ;;
      --through) THROUGH="${2:?}"; shift 2 ;;
      --scale) SCALE=1; shift ;;
      --scale-projects) SCALE_PROJECTS="${2:?}"; shift 2 ;;
      --scale-users) SCALE_USERS="${2:?}"; shift 2 ;;
      --bounds) BOUNDS="${2:?}"; shift 2 ;;
      -h | --help) usage; exit 0 ;;
      *) die_usage "unknown argument: $1" ;;
    esac
  done
}

# Resolves the origin into the old image; prints the plan as key=value lines.
resolve_plan() {
  case "$ORIGIN" in
    3.20.1) OLD_IMAGE="${OLD_IMAGE:-langwatch/langwatch:3.20.1}" ;;
    main)
      if [[ -z "$OLD_IMAGE" && "$BUILD_MAIN" -eq 0 ]]; then
        die_usage "origin main needs --old-image IMAGE or --build-main (builds origin/main)"
      fi
      if [[ "$BUILD_MAIN" -eq 1 ]]; then OLD_IMAGE="${OLD_IMAGE:-langwatch-rehearsal:main}"; fi
      ;;
    empty)
      [[ -n "$OLD_IMAGE" ]] && die_usage "origin empty takes no old image"
      ;;
    *) die_usage "unknown origin: $ORIGIN (3.20.1, main or empty)" ;;
  esac
  case "$ORDER" in api-first | worker-first) ;; *) die_usage "unknown order: $ORDER" ;; esac
  case "$THROUGH" in 2 | 3 | 4 | 5) ;; *) die_usage "unknown --through: $THROUGH (2 to 5)" ;; esac
  if [[ "$ORIGIN" == "empty" && "$THROUGH" -gt 2 && "$THROUGH" -lt 5 ]]; then
    die_usage "origin empty has no old image to roll back to; use --through 2 or 5"
  fi
  [[ -n "$BOUNDS" && ! -f "$BOUNDS" ]] && die_usage "no bounds file: $BOUNDS"
  if [[ -z "$HEAD_IMAGE" && "$BUILD_HEAD" -eq 0 ]]; then
    die_usage "head needs --head-image IMAGE or --build-head (builds this working tree)"
  fi
  if [[ "$BUILD_HEAD" -eq 1 ]]; then HEAD_IMAGE="${HEAD_IMAGE:-langwatch-rehearsal:head}"; fi
  local seeds="$SEED_TRACES"
  [[ "$ORIGIN" == "empty" ]] && seeds=0
  local phases="0 1 2"
  if [[ "$ORIGIN" == "empty" ]]; then
    [[ "$THROUGH" -ge 5 ]] && phases="$phases 5"
  else
    for ((n = 3; n <= THROUGH; n++)); do phases="$phases $n"; done
  fi
  [[ "$SCALE" -eq 1 ]] && phases="$phases 6"
  printf 'origin=%s\nold_image=%s\nhead_image=%s\norder=%s\nseed_traces=%s\nphases=%s\n' \
    "$ORIGIN" "$OLD_IMAGE" "$HEAD_IMAGE" "$ORDER" "$seeds" "$phases"
}

# Names every missing prerequisite at once; exits 3 when any is missing.
preflight() {
  local missing=()
  if ! command -v docker >/dev/null 2>&1; then
    missing+=("the docker client")
  else
    docker info >/dev/null 2>&1 || missing+=("a reachable docker daemon (docker info failed)")
    docker compose version >/dev/null 2>&1 || missing+=("the docker compose plugin")
  fi
  local tool
  for tool in node curl; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if ((${#missing[@]})); then
    echo "rehearse: this host cannot run the rehearsal; missing:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    exit "$EXIT_ENVIRONMENT"
  fi
}

log() { printf '[rehearse %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$RUN_DIR/rehearse.log" >&2; }

compose() {
  OLD_IMAGE="${OLD_IMAGE:-langwatch/langwatch:3.20.1}" HEAD_IMAGE="$HEAD_IMAGE" \
    REHEARSAL_ENV_FILE="$RUN_DIR/rehearsal.env" REHEARSAL_PROJECT="$PROJECT" \
    docker compose -f "$HERE/compose.yml" --profile old --profile head "$@"
}

psql_at() { compose exec -T postgres psql -U prisma -d mydb -At -v ON_ERROR_STOP=1 -c "$1"; }

# A JSON array of the query's rows, or [] when the relation does not exist yet.
psql_json() { psql_at "SELECT coalesce(json_agg(t), '[]'::json) FROM ($1) t" 2>/dev/null || echo '[]'; }

write_env_file() {
  local secret
  secret() { node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'; }
  {
    echo "BASE_HOST=http://localhost:${OLD_APP_PORT}"
    echo "NEXTAUTH_URL=http://localhost:${OLD_APP_PORT}"
    echo "AUTH_PROVIDER=email"
    echo "IS_SAAS=true"
    echo "GROUP_QUEUE_ENVELOPE_WRITES_ENABLED=true"
    for key in NEXTAUTH_SECRET CREDENTIALS_SECRET API_TOKEN_JWT_SECRET LW_VIRTUAL_KEY_PEPPER \
      LW_GATEWAY_INTERNAL_SECRET LW_GATEWAY_JWT_SECRET LANGWATCH_NLP_INTERNAL_SECRET LANGY_INTERNAL_SECRET; do
      echo "$key=$(secret)"
    done
    echo "ENVIRONMENT=rehearsal"
    echo "ADMIN_EMAILS=rollback+${RUN_ID}@rehearsal.test,seed+${RUN_ID}@rehearsal.test"
    # The second organisation's private ClickHouse route (tenancy.ts: CLICKHOUSE_URL__<label>__<org>).
    echo "CLICKHOUSE_URL__rehearsal__rh_${RUN_ID}_org_b=http://default:langwatch@clickhouse-private:8123/langwatch"
  } >"$RUN_DIR/rehearsal.env"
}

wait_http() {
  local url="$1" seconds="$2" code
  for ((i = 0; i < seconds; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    [[ "$code" =~ ^2 ]] && return 0
    sleep 1
  done
  return 1
}

# Posts in batches of at most 500 traces (1,000 spans), so a large seed stays under the body limit.
post_traces() {
  local key="$1" left="$2" count out
  while ((left > 0)); do
    count=$((left < 500 ? left : 500))
    left=$((left - count))
    out="$(node "$HERE/otlp-batch.mjs" "rehearsal-$key" "$count" |
      curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
        -H "X-Auth-Token: $key" --data-binary @- "http://localhost:${OLD_APP_PORT}/api/otel/v1/traces" || true)"
    echo "$(date -u +%FT%TZ) $key $count $out" >>"$RUN_DIR/evidence/ingest.log"
  done
}

# Every group-queue key under any queue with its size, as a flat JSON [key, size, ...] array.
snapshot_queues() {
  local lua='local out={} local c="0" repeat local r=redis.call("SCAN",c,"MATCH","*:gq:*:jobs","COUNT",1000) c=r[1] for _,k in ipairs(r[2]) do local t=redis.call("TYPE",k)["ok"] local n=0 if t=="zset" then n=redis.call("ZCARD",k) elseif t=="list" then n=redis.call("LLEN",k) elseif t=="hash" then n=redis.call("HLEN",k) elseif t=="set" then n=redis.call("SCARD",k) end out[#out+1]=k out[#out+1]=tostring(n) end until c=="0" return cjson.encode(out)'
  compose exec -T redis redis-cli --raw EVAL "$lua" 0 >"$RUN_DIR/evidence/$1"
}

ledger_query() {
  local schema="mydb_upgrade_ledger"
  psql_json "SELECT id, kind, mode, status, attempt, last_error, report, started_at, finished_at FROM \"$schema\".\"_langwatch_upgrade_step\" ORDER BY id" >"$RUN_DIR/evidence/$1"
}

build_images() {
  if [[ "$BUILD_MAIN" -eq 1 ]]; then
    log "building $OLD_IMAGE from origin/main"
    git -C "$REPO_ROOT" archive --format=tar origin/main |
      docker build -f infra/docker/Dockerfile -t "$OLD_IMAGE" - >>"$RUN_DIR/build.log" 2>&1
  fi
  if [[ "$BUILD_HEAD" -eq 1 ]]; then
    log "building $HEAD_IMAGE from the working tree"
    # A rehearsal image is never shipped: unstamped, so sh-licensed can trust the test key.
    docker build -f "$REPO_ROOT/infra/docker/Dockerfile" --build-arg LANGWATCH_RELEASE_BUILD=false -t "$HEAD_IMAGE" "$REPO_ROOT" >>"$RUN_DIR/build.log" 2>&1
  fi
}

# Phase 0 product seeds through the old image's tRPC as a seeded account (seed/product.mjs).
# A failure is evidence: each kind it left unseeded reads inconclusive.
phase0_products() {
  SEED_EMAIL="seed+${RUN_ID}@rehearsal.test"
  SEED_PASSWORD="Seed-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
  mkdir -p "$RUN_DIR/evidence/logs"
  # A throwaway stack's test login, for whoever inspects a --keep stack (run dir is gitignored).
  printf 'email=%s\npassword=%s\n' "$SEED_EMAIL" "$SEED_PASSWORD" >"$RUN_DIR/login.txt"
  write_psql_shim
  log "phase 0: product seeds through the old image's tRPC"
  PATH="$RUN_DIR/bin:$PATH" DATABASE_URL="postgresql://prisma:prisma@postgres:5432/mydb?schema=mydb" \
    bash "$REPO_ROOT/dev/scripts/migration-compat-smoke/seed-account.sh" "$SEED_EMAIL" "$SEED_PASSWORD" \
    >"$RUN_DIR/evidence/logs/product-seed.log" 2>&1 &&
    APP_BASE="http://localhost:${OLD_APP_PORT}" SEED_EMAIL="$SEED_EMAIL" SEED_PASSWORD="$SEED_PASSWORD" \
      SEED_LABEL="$RUN_ID" SEED_PER_KIND="$SEED_PER_KIND" OUT="$RUN_DIR/evidence/product-seeds.json" node "$HERE/seed/product.mjs" seed \
      >>"$RUN_DIR/evidence/logs/product-seed.log" 2>&1 ||
    log "phase 0: product seeds failed (logs/product-seed.log); their findings read inconclusive"
}

# Phase 2 reads every seeded kind back through head's api with the same account.
collect_products() {
  [[ -s "$RUN_DIR/evidence/product-seeds.json" ]] || return 0
  APP_BASE="http://localhost:${HEAD_API_PORT}" SEED_EMAIL="$SEED_EMAIL" SEED_PASSWORD="$SEED_PASSWORD" \
    SEEDS="$RUN_DIR/evidence/product-seeds.json" OUT="$RUN_DIR/evidence/product-readback.json" \
    node "$HERE/seed/product.mjs" readback >"$RUN_DIR/evidence/logs/product-readback.log" 2>&1 ||
    log "phase 2: product read-back failed (logs/product-readback.log)"
}

phase0_seed() {
  log "phase 0: stores up"
  compose up -d --wait postgres redis clickhouse clickhouse-private
  [[ "$ORIGIN" == "empty" ]] && return 0
  log "phase 0: old image $OLD_IMAGE up"
  compose up -d old-app old-worker
  wait_http "http://localhost:${OLD_APP_PORT}/api/health" 600 || { log "old app never became healthy"; return 1; }
  compose exec -T postgres psql -U prisma -d mydb -v run="$RUN_ID" -f - <"$HERE/seed/tenancy.sql" >>"$RUN_DIR/rehearse.log"
  phase0_products
  local key
  for key in team personal orgb; do post_traces "sk-lw-rh${RUN_ID}${key}" "$SEED_TRACES"; done
  log "phase 0: letting the old worker process the seed"
  sleep 60
  log "phase 0: pausing the old worker and queueing jobs at the cut"
  compose pause old-worker
  for key in team personal orgb; do post_traces "sk-lw-rh${RUN_ID}${key}" 20; done
  sleep 5
  snapshot_queues queues-cut.json
  log "phase 7: exporting the old image's event_log for head's parse"
  clickhouse_at clickhouse "SELECT * FROM event_log FORMAT JSONEachRow" >"$RUN_DIR/evidence/event-log.jsonl" || true
  [[ "$SCALE" -eq 1 ]] && phase6_seed
  return 0
}

clickhouse_at() { compose exec -T "$1" clickhouse-client --password langwatch --database langwatch --query "$2"; }

# Phase 6's tenant set at the old schema; spans at scale are not seeded yet (see README).
phase6_seed() {
  log "phase 6: seeding $SCALE_PROJECTS projects and $SCALE_USERS users"
  local started=$SECONDS
  compose exec -T postgres psql -U prisma -d mydb -v run="$RUN_ID" -v projects="$SCALE_PROJECTS" \
    -v users="$SCALE_USERS" -f - <"$HERE/seed/scale.sql" >>"$RUN_DIR/rehearse.log"
  printf '{"projects":%s,"users":%s,"seedSeconds":%s}' "$SCALE_PROJECTS" "$SCALE_USERS" \
    "$((SECONDS - started))" >"$RUN_DIR/evidence/scale.json"
}

# Samples every container's memory each 5 s into memory.log until teardown.
start_memory_sampler() {
  (while :; do
    ids="$(compose ps -q 2>/dev/null || true)"
    # shellcheck disable=SC2086
    [[ -n "$ids" ]] && docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' $ids >>"$RUN_DIR/evidence/memory.log" 2>/dev/null
    sleep 5
  done) &
  SAMPLER_PID=$!
}

start_load() {
  [[ "$ORIGIN" == "empty" ]] && return 0
  (while :; do post_traces "sk-lw-rh${RUN_ID}team" 5; sleep 2; done) &
  LOAD_PID=$!
}

stop_load() { [[ -n "${LOAD_PID:-}" ]] && kill "$LOAD_PID" 2>/dev/null || true; LOAD_PID=""; }

# Signals the head worker once a background step runs; writes <name>-drill.json and restarts it.
drill() {
  local signal="$1" name="$2" deadline=$((SECONDS + DRILL_SECONDS)) running="[]"
  while ((SECONDS < deadline)); do
    running="$(psql_json "SELECT id FROM \"mydb_upgrade_ledger\".\"_langwatch_upgrade_step\" WHERE status = 'running' AND mode = 'background'")"
    [[ "$running" != "[]" ]] && break
    sleep 1
  done
  local signal_at exited_at
  signal_at="$(date -u +%FT%T.%3NZ)"
  compose kill -s "$signal" head-worker >/dev/null
  compose wait head-worker >/dev/null 2>&1 || true
  exited_at="$(date -u +%FT%T.%3NZ)"
  ledger_query "$name-after.json"
  node -e '
    const [running, after, signalAt, exitedAt] = process.argv.slice(1);
    const ids = JSON.parse(running).map((r) => r.id);
    process.stdout.write(JSON.stringify({ signalAt, exitedAt, runningAtSignal: ids, after: JSON.parse(after) }, null, 2));
  ' "$running" "$(cat "$RUN_DIR/evidence/$name-after.json")" "$signal_at" "$exited_at" >"$RUN_DIR/evidence/$name-drill.json"
  compose up -d head-worker
}

# Docker refuses to kill a paused container; the unpause-to-kill window is milliseconds.
stop_paused_worker() {
  compose unpause old-worker >/dev/null 2>&1 || true
  compose kill old-worker >/dev/null
}

phase1_overlap() {
  start_load
  log "phase 1: head's upgrade while the old api serves"
  local status=0
  compose run --rm head-migrate >"$RUN_DIR/evidence/logs/head-migrate.log" 2>&1 || status=$?
  echo "$status" >"$RUN_DIR/evidence/head-migrate.exit"
  ((status == 0)) || log "head's upgrade exited $status; continuing to collect evidence"
  if [[ "$ORIGIN" != "empty" ]]; then
    log "phase 1: restarting the old api over head's schema (its start re-runs start:prepare:db)"
    compose restart old-app
    if wait_http "http://localhost:${OLD_APP_PORT}/api/health" 300; then echo serving; else echo refused; fi \
      >"$RUN_DIR/evidence/old-app-restart.txt"
  fi
  log "phase 1: head api and worker up beside the old ones"
  compose up -d --no-deps head-api head-worker
  wait_http "http://localhost:${HEAD_API_PORT}/api/health" 600 || log "head api never answered /api/health"
  log "phase 1: SIGTERM drill on the head worker (F-2)"
  drill SIGTERM f2
  [[ "$ORIGIN" == "empty" ]] && return 0
  if [[ "$ORDER" == "api-first" ]]; then
    compose stop old-app
    stop_load
    stop_paused_worker
  else
    stop_paused_worker
    sleep 30
    stop_load
    compose stop old-app
  fi
}

# One row per seeded project: its privacy and retention scope rows (Postgres) and a folded trace
# summary (ClickHouse trace_summaries, TenantId = project id), read-only.
collect_resolution() {
  local projects folded
  projects="$(psql_json "SELECT p.id AS \"projectId\", dp.\"projectId\" IS NOT NULL AS privacy, dr.\"projectId\" IS NOT NULL AS retention FROM mydb.\"Project\" p LEFT JOIN mydb.\"DataPrivacyProjectScope\" dp ON dp.\"projectId\" = p.id LEFT JOIN mydb.\"DataRetentionProjectScope\" dr ON dr.\"projectId\" = p.id WHERE p.id LIKE 'rh\\_${RUN_ID}\\_%' ORDER BY p.id")"
  folded="$(compose exec -T clickhouse clickhouse-client --password langwatch --database langwatch --query "SELECT DISTINCT TenantId FROM trace_summaries WHERE TenantId LIKE 'rh\\_${RUN_ID}\\_%' FORMAT JSONEachRow" 2>/dev/null || true)"
  node -e '
    const projects = JSON.parse(process.argv[1]);
    const folded = new Set(process.argv[2].split("\n").filter(Boolean).map((l) => JSON.parse(l).TenantId));
    const rows = projects.map((p) => ({ projectId: p.projectId, privacy: p.privacy, retention: p.retention, folded: folded.has(p.projectId) }));
    process.stdout.write(JSON.stringify(rows));
  ' "$projects" "$folded" >"$RUN_DIR/evidence/resolution.json"
}

# Spans the old api accepted (two per trace, 2xx rows of ingest.log) against those head stores.
collect_spans() {
  local sent stored=0 target n
  sent="$(awk '$4 ~ /^2/ { n += $3 * 2 } END { print n + 0 }' "$RUN_DIR/evidence/ingest.log" 2>/dev/null || echo 0)"
  for ((i = 0; i < 60; i++)); do
    stored=0
    for target in clickhouse clickhouse-private; do
      n="$(clickhouse_at "$target" "SELECT count() FROM stored_spans WHERE TenantId LIKE 'rh\\_${RUN_ID}\\_%'" 2>/dev/null || echo 0)"
      stored=$((stored + ${n:-0}))
    done
    ((stored >= sent)) && break
    sleep 5
  done
  printf '{"sent":%s,"stored":%s}' "$sent" "$stored" >"$RUN_DIR/evidence/spans.json"
}

settle() {
  local deadline=$((SECONDS + SETTLE_SECONDS)) open
  while ((SECONDS < deadline)); do
    open="$(psql_at "SELECT count(*) FROM \"mydb_upgrade_ledger\".\"_langwatch_upgrade_step\" WHERE mode = 'background' AND status IN ('pending', 'running')" 2>/dev/null || echo 1)"
    [[ "$open" == "0" ]] && break
    sleep 5
  done
}

goose_version() { clickhouse_at "$1" "SELECT max(version_id) FROM goose_db_version FORMAT JSONEachRow" 2>/dev/null | node -e 'const l=require("node:fs").readFileSync(0,"utf8").trim(); process.stdout.write(l ? String(Object.values(JSON.parse(l))[0]) : "null")'; }

phase2_collect() {
  log "phase 2: settling for up to ${SETTLE_SECONDS}s"
  settle
  ledger_query ledger-steps.json
  printf '{"shared":%s,"private":%s}' "$(goose_version clickhouse)" "$(goose_version clickhouse-private)" \
    >"$RUN_DIR/evidence/goose-targets.json"
  psql_json "SELECT step_id, target, status, version, last_error FROM \"mydb_upgrade_ledger\".\"_langwatch_upgrade_target\" ORDER BY step_id, target" >"$RUN_DIR/evidence/ledger-targets.json"
  psql_json "SELECT process_id, role, image, release, steps, heartbeat_at FROM \"mydb_upgrade_ledger\".\"_langwatch_serving_roster\"" >"$RUN_DIR/evidence/ledger-roster.json"
  collect_resolution
  collect_spans
  collect_products
  snapshot_queues queues-settled.json
  curl -s "http://localhost:${HEAD_WORKER_METRICS_PORT}/metrics" >"$RUN_DIR/evidence/head-worker.metrics" || rm -f "$RUN_DIR/evidence/head-worker.metrics"
  local svc
  for svc in old-app old-worker head-api head-worker; do
    compose logs --no-color --no-log-prefix "$svc" >"$RUN_DIR/evidence/logs/$svc.log" 2>&1 || true
  done
}

head_task() { compose run --rm -w /app/apps/tasks head-migrate pnpm --silent task "$@"; }

# The smoke's psql, run in the postgres container; the head database's tables live in schema mydb.
write_psql_shim() {
  mkdir -p "$RUN_DIR/bin"
  cat >"$RUN_DIR/bin/psql" <<EOF
#!/usr/bin/env bash
opts=()
case "\$*" in */mydb*) opts=(-e PGOPTIONS=-csearch_path=mydb) ;; esac
exec env OLD_IMAGE="$OLD_IMAGE" HEAD_IMAGE="$HEAD_IMAGE" REHEARSAL_ENV_FILE="$RUN_DIR/rehearsal.env" \\
  REHEARSAL_PROJECT="$PROJECT" docker compose -f "$HERE/compose.yml" exec -T "\${opts[@]}" postgres psql "\$@"
EOF
  chmod +x "$RUN_DIR/bin/psql"
}

# Phase 3: head stops, the old image starts on head's schema with no head upgrade (a Helm rollback).
phase3_rollback() {
  local developer=false pre=0 serving=false smoke=1 email="rollback+${RUN_ID}@rehearsal.test"
  if [[ "$ORIGIN" == "3.20.1" ]]; then
    log "phase 3: head writes a DEVELOPER membership and joiner role (P31)"
    psql_at "UPDATE mydb.\"OrganizationUser\" SET role = 'DEVELOPER' WHERE \"userId\" = 'rh_${RUN_ID}_u_never' AND \"organizationId\" = 'rh_${RUN_ID}_org_a'; UPDATE mydb.\"Organization\" SET \"joinerRole\" = 'DEVELOPER' WHERE id = 'rh_${RUN_ID}_org_a'" \
      >>"$RUN_DIR/rehearse.log" && developer=true
  fi
  ledger_query ledger-steps-before-rollback.json
  compose stop head-api head-worker
  log "phase 3: recording the rollback to an image before the serving roster"
  head_task upgrade pre-roster-rollback >"$RUN_DIR/evidence/logs/pre-roster-rollback.log" 2>&1 || pre=$?
  compose rm -sf old-app old-worker >/dev/null
  compose up -d old-app old-worker
  wait_http "http://localhost:${OLD_APP_PORT}/api/health" 600 && serving=true
  if [[ "$serving" == true ]]; then
    write_psql_shim
    local password="Rollback-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
    smoke=0
    PATH="$RUN_DIR/bin:$PATH" DATABASE_URL="postgresql://prisma:prisma@postgres:5432/mydb?schema=mydb" \
      bash "$REPO_ROOT/dev/scripts/migration-compat-smoke/seed-account.sh" "$email" "$password" \
      >"$RUN_DIR/evidence/logs/rollback-smoke.log" 2>&1 &&
      APP_BASE="http://localhost:${OLD_APP_PORT}" SMOKE_EMAIL="$email" SMOKE_PASSWORD="$password" \
        SMOKE_LABEL="rollback" node "$REPO_ROOT/dev/scripts/migration-compat-smoke/smoke.mjs" \
        >>"$RUN_DIR/evidence/logs/rollback-smoke.log" 2>&1 || smoke=$?
    sleep 30
  fi
  compose logs --no-color --no-log-prefix old-app >"$RUN_DIR/evidence/logs/old-app-rollback.log" 2>&1 || true
  compose logs --no-color --no-log-prefix old-worker >"$RUN_DIR/evidence/logs/old-worker-rollback.log" 2>&1 || true
  printf '{"serving":%s,"smokeExit":%s,"developerSeeded":%s,"preRosterExit":%s}' \
    "$serving" "$smoke" "$developer" "$pre" >"$RUN_DIR/evidence/rollback.json"
}

# Phase 5's lease drill: takes the runner lease from a running upgrade, then re-runs it.
lease_drill() {
  local name="$PROJECT-lease" stolen=false exit_code rerun=0
  compose run -d --name "$name" -w /app/apps/tasks head-migrate pnpm --silent task upgrade >/dev/null
  for ((i = 0; i < 120; i++)); do
    [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == true ]] || break
    if [[ -n "$(psql_at "UPDATE \"mydb_upgrade_ledger\".\"_langwatch_upgrade_lease\" SET owner = 'rehearsal-thief' WHERE expires_at > now() RETURNING 1" 2>/dev/null)" ]]; then
      stolen=true
      break
    fi
    sleep 0.5
  done
  for ((i = 0; i < 600; i++)); do
    [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == true ]] || break
    sleep 1
  done
  docker kill "$name" >/dev/null 2>&1 || true
  exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"
  docker logs "$name" >"$RUN_DIR/evidence/logs/head-migrate-lease.log" 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  sleep 65 # the stolen lease's 60 s expiry, so the re-run can take it
  head_task upgrade >"$RUN_DIR/evidence/logs/head-migrate-2.log" 2>&1 || rerun=$?
  printf '{"stolen":%s,"exit":%s,"rerunExit":%s}' "$stolen" "$exit_code" "$rerun" >"$RUN_DIR/evidence/lease-drill.json"
  REUPGRADE_EXIT=$rerun
}

# Phase 4 re-upgrade, with phase 5's drills when --through 5: lease loss, SIGKILL, ClickHouse pause.
phase4_reupgrade() {
  snapshot_queues queues-rollback.json
  compose stop old-app
  stop_paused_worker
  REUPGRADE_EXIT=0
  if [[ "$THROUGH" -ge 5 ]]; then
    lease_drill
  else
    head_task upgrade >"$RUN_DIR/evidence/logs/head-migrate-2.log" 2>&1 || REUPGRADE_EXIT=$?
  fi
  compose up -d --no-deps head-api head-worker
  wait_http "http://localhost:${HEAD_API_PORT}/api/health" 600 || log "head api never answered after the rollback"
  head_task upgrade old-writers-gone >"$RUN_DIR/evidence/logs/old-writers-gone.log" 2>&1 || true
  if [[ "$THROUGH" -ge 5 ]]; then
    drill SIGKILL kill
    log "phase 5: a transient ClickHouse refusal (paused 20 s)"
    compose pause clickhouse && sleep 20 && compose unpause clickhouse
  fi
  settle
  ledger_query ledger-steps-reupgrade.json
  snapshot_queues queues-reupgrade.json
  printf '{"migrateExit":%s}' "$REUPGRADE_EXIT" >"$RUN_DIR/evidence/reupgrade.json"
}

# Phase 5: a second upgrade run over a settled ledger applies nothing.
phase5_noop() {
  local exit_code=0
  ledger_query ledger-steps-noop-before.json
  head_task upgrade >"$RUN_DIR/evidence/logs/head-migrate-noop.log" 2>&1 || exit_code=$?
  ledger_query ledger-steps-noop-after.json
  printf '{"exit":%s}' "$exit_code" >"$RUN_DIR/evidence/noop.json"
}

teardown() {
  stop_load
  [[ -n "${SAMPLER_PID:-}" ]] && kill "$SAMPLER_PID" 2>/dev/null || true
  [[ "$KEEP" -eq 1 ]] && { log "kept the stack: docker compose -p $PROJECT -f $HERE/compose.yml down -v"; return; }
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}

main() {
  parse_args "$@"
  local plan
  plan="$(resolve_plan)"
  if [[ "$PLAN_ONLY" -eq 1 ]]; then echo "$plan"; exit 0; fi
  eval "$(echo "$plan" | sed -n 's/^old_image=\(.*\)$/OLD_IMAGE="\1"/p; s/^head_image=\(.*\)$/HEAD_IMAGE="\1"/p')"
  preflight
  RUN_ID="$(date -u +%m%d%H%M%S)"
  PROJECT="lw-rehearsal-${RUN_ID}"
  RUN_DIR="${RUN_DIR:-$REPO_ROOT/.claude/tmp/upgrade-rehearsal/$ORIGIN-$ORDER-$RUN_ID}"
  OLD_APP_PORT="${OLD_APP_PORT:-15560}" HEAD_API_PORT="${HEAD_API_PORT:-16560}"
  HEAD_WORKER_METRICS_PORT="${HEAD_WORKER_METRICS_PORT:-12999}"
  export OLD_APP_PORT HEAD_API_PORT HEAD_WORKER_METRICS_PORT
  mkdir -p "$RUN_DIR/evidence/logs"
  write_env_file
  node -e 'process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(1).map((kv) => kv.split(/=(.*)/s).slice(0, 2))), null, 2))' \
    $plan "startedAt=$(date -u +%FT%TZ)" "runId=$RUN_ID" |
    node -e 'const p=JSON.parse(require("node:fs").readFileSync(0,"utf8")); process.stdout.write(JSON.stringify({origin:p.origin, oldImage:p.old_image||null, headImage:p.head_image, order:p.order, startedAt:p.startedAt, runId:p.runId}, null, 2))' \
      >"$RUN_DIR/evidence/run.json"
  trap teardown EXIT
  [[ -n "$BOUNDS" ]] && cp "$BOUNDS" "$RUN_DIR/evidence/bounds.json"
  build_images
  start_memory_sampler
  phase0_seed
  phase1_overlap
  phase2_collect
  if [[ "$ORIGIN" != "empty" && "$THROUGH" -ge 3 ]]; then
    phase3_rollback
    [[ "$THROUGH" -ge 4 ]] && phase4_reupgrade
  fi
  [[ "$THROUGH" -ge 5 ]] && phase5_noop
  node "$HERE/evaluate.mjs" "$RUN_DIR"
  log "report: $RUN_DIR/report.md"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
