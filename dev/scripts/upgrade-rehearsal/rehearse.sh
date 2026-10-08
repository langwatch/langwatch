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
RUN_DIR=""
KEEP=0
PLAN_ONLY=0

usage() {
  cat <<'EOF'
usage: rehearse.sh [--origin 3.20.1|main|empty] [--old-image IMAGE | --build-main]
                   [--head-image IMAGE | --build-head] [--order api-first|worker-first]
                   [--settle-seconds N] [--drill-seconds N] [--seed-traces N]
                   [--run-dir DIR] [--keep] [--plan-only]
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
      --run-dir) RUN_DIR="${2:?}"; shift 2 ;;
      --keep) KEEP=1; shift ;;
      --plan-only) PLAN_ONLY=1; shift ;;
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
  if [[ -z "$HEAD_IMAGE" && "$BUILD_HEAD" -eq 0 ]]; then
    die_usage "head needs --head-image IMAGE or --build-head (builds this working tree)"
  fi
  if [[ "$BUILD_HEAD" -eq 1 ]]; then HEAD_IMAGE="${HEAD_IMAGE:-langwatch-rehearsal:head}"; fi
  local seeds="$SEED_TRACES"
  [[ "$ORIGIN" == "empty" ]] && seeds=0
  printf 'origin=%s\nold_image=%s\nhead_image=%s\norder=%s\nseed_traces=%s\n' \
    "$ORIGIN" "$OLD_IMAGE" "$HEAD_IMAGE" "$ORDER" "$seeds"
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
    for key in NEXTAUTH_SECRET CREDENTIALS_SECRET API_TOKEN_JWT_SECRET LW_VIRTUAL_KEY_PEPPER \
      LW_GATEWAY_INTERNAL_SECRET LW_GATEWAY_JWT_SECRET LANGWATCH_NLP_INTERNAL_SECRET LANGY_INTERNAL_SECRET; do
      echo "$key=$(secret)"
    done
    echo "ENVIRONMENT=rehearsal"
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

post_traces() {
  local key="$1" count="$2" out
  out="$(node "$HERE/otlp-batch.mjs" "rehearsal-$key" "$count" |
    curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
      -H "X-Auth-Token: $key" --data-binary @- "http://localhost:${OLD_APP_PORT}/api/otel/v1/traces" || true)"
  echo "$(date -u +%FT%TZ) $key $count $out" >>"$RUN_DIR/evidence/ingest.log"
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
    docker build -f "$REPO_ROOT/infra/docker/Dockerfile" -t "$HEAD_IMAGE" "$REPO_ROOT" >>"$RUN_DIR/build.log" 2>&1
  fi
}

phase0_seed() {
  log "phase 0: stores up"
  compose up -d --wait postgres redis clickhouse
  [[ "$ORIGIN" == "empty" ]] && return 0
  log "phase 0: old image $OLD_IMAGE up"
  compose up -d old-app old-worker
  wait_http "http://localhost:${OLD_APP_PORT}/api/health" 600 || { log "old app never became healthy"; return 1; }
  compose exec -T postgres psql -U prisma -d mydb -v run="$RUN_ID" -f - <"$HERE/seed/tenancy.sql" >>"$RUN_DIR/rehearse.log"
  local key
  for key in team personal orgb; do post_traces "sk-lw-rh${RUN_ID}${key}" "$SEED_TRACES"; done
  log "phase 0: letting the old worker process the seed"
  sleep 60
  log "phase 0: pausing the old worker and queueing jobs at the cut"
  compose pause old-worker
  for key in team personal orgb; do post_traces "sk-lw-rh${RUN_ID}${key}" 20; done
  sleep 5
  snapshot_queues queues-cut.json
}

start_load() {
  [[ "$ORIGIN" == "empty" ]] && return 0
  (while :; do post_traces "sk-lw-rh${RUN_ID}team" 5; sleep 2; done) &
  LOAD_PID=$!
}

stop_load() { [[ -n "${LOAD_PID:-}" ]] && kill "$LOAD_PID" 2>/dev/null || true; LOAD_PID=""; }

f2_drill() {
  local deadline=$((SECONDS + DRILL_SECONDS)) running="[]"
  while ((SECONDS < deadline)); do
    running="$(psql_json "SELECT id FROM \"mydb_upgrade_ledger\".\"_langwatch_upgrade_step\" WHERE status = 'running' AND mode = 'background'")"
    [[ "$running" != "[]" ]] && break
    sleep 1
  done
  local signal_at exited_at
  signal_at="$(date -u +%FT%T.%3NZ)"
  compose kill -s SIGTERM head-worker >/dev/null
  compose wait head-worker >/dev/null 2>&1 || true
  exited_at="$(date -u +%FT%T.%3NZ)"
  ledger_query f2-after.json
  node -e '
    const [running, after, signalAt, exitedAt] = process.argv.slice(1);
    const ids = JSON.parse(running).map((r) => r.id);
    process.stdout.write(JSON.stringify({ signalAt, exitedAt, runningAtSignal: ids, after: JSON.parse(after) }, null, 2));
  ' "$running" "$(cat "$RUN_DIR/evidence/f2-after.json")" "$signal_at" "$exited_at" >"$RUN_DIR/evidence/f2-drill.json"
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
  f2_drill
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

phase2_collect() {
  log "phase 2: settling for up to ${SETTLE_SECONDS}s"
  local deadline=$((SECONDS + SETTLE_SECONDS)) open
  while ((SECONDS < deadline)); do
    open="$(psql_at "SELECT count(*) FROM \"mydb_upgrade_ledger\".\"_langwatch_upgrade_step\" WHERE mode = 'background' AND status IN ('pending', 'running')" 2>/dev/null || echo 1)"
    [[ "$open" == "0" ]] && break
    sleep 5
  done
  ledger_query ledger-steps.json
  psql_json "SELECT step_id, target, status, version, last_error FROM \"mydb_upgrade_ledger\".\"_langwatch_upgrade_target\" ORDER BY step_id, target" >"$RUN_DIR/evidence/ledger-targets.json"
  psql_json "SELECT process_id, role, image, release, steps, heartbeat_at FROM \"mydb_upgrade_ledger\".\"_langwatch_serving_roster\"" >"$RUN_DIR/evidence/ledger-roster.json"
  psql_json "SELECT p.id AS \"projectId\", dp.\"projectId\" IS NOT NULL AS privacy, dr.\"projectId\" IS NOT NULL AS retention FROM mydb.\"Project\" p LEFT JOIN mydb.\"DataPrivacyProjectScope\" dp ON dp.\"projectId\" = p.id LEFT JOIN mydb.\"DataRetentionProjectScope\" dr ON dr.\"projectId\" = p.id WHERE p.id LIKE 'rh\\_${RUN_ID}\\_%' ORDER BY p.id" >"$RUN_DIR/evidence/scope.json"
  snapshot_queues queues-settled.json
  curl -s "http://localhost:${HEAD_WORKER_METRICS_PORT}/metrics" >"$RUN_DIR/evidence/head-worker.metrics" || rm -f "$RUN_DIR/evidence/head-worker.metrics"
  local svc
  for svc in old-app old-worker head-api head-worker; do
    compose logs --no-color --no-log-prefix "$svc" >"$RUN_DIR/evidence/logs/$svc.log" 2>&1 || true
  done
}

teardown() {
  stop_load
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
  build_images
  phase0_seed
  phase1_overlap
  phase2_collect
  node "$HERE/evaluate.mjs" "$RUN_DIR"
  log "report: $RUN_DIR/report.md"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
