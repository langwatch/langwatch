#!/usr/bin/env bash
# Full-stack E2E tests for the langwatch Helm chart.
#
# Deploys the complete stack (ClickHouse 3-node cluster, app, 2 workers, NLP,
# langevals, PostgreSQL, Redis) to a Kind cluster, seeds the database, sends a
# trace through the collector API, and verifies every service is healthy.
#
# Requirements: kind, helm, kubectl, docker
# Environment:
#   KEEP_CLUSTER=true  — skip Kind cluster deletion on exit (for debugging)
#   CLUSTER_NAME       — Kind cluster name (default: lw-full)
#   TIMEOUT            — helm --wait timeout in seconds (default: 600)
#   SKIP_BUILD=true    — skip image builds (use pre-built images)

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-lw-full}"
RELEASE="lw"
NAMESPACE="lw-test"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="${CHART_DIR}/../.."
TIMEOUT="${TIMEOUT:-600}"

# Source shared helpers
# shellcheck source=../../lib/test-helpers.sh
source "$(cd "$(dirname "$0")/../../lib" && pwd)/test-helpers.sh"

trap cleanup_cluster EXIT

# ─── Image names ───────────────────────────────────────────────────────────
APP_IMAGE="langwatch/langwatch:local"
NLP_IMAGE="langwatch/langwatch_nlp:local"
LANGEVALS_IMAGE="langwatch/langevals:local"
CH_IMAGE="langwatch/clickhouse-serverless:0.1.0"

# ─── Helpers ───────────────────────────────────────────────────────────────
pg_query() {
  local pod="$1" query="$2"
  kc exec "$pod" -- \
    sh -c "PGPASSWORD=e2etest psql -U postgres -d langwatch -t -c \"$query\"" \
    | tr -d ' \n'
}

# ─────────────────────────────────────────────────────────────────────────────
# Build and load all Docker images into Kind
# ─────────────────────────────────────────────────────────────────────────────
build_and_load_images() {
  sep; info "Building and loading images"

  if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
    # ClickHouse
    if ! docker image inspect "$CH_IMAGE" &>/dev/null; then
      info "Building ClickHouse image..."
      make -C "${CHART_DIR}/../clickhouse-serverless" images
    fi

    # App
    if ! docker image inspect "$APP_IMAGE" &>/dev/null; then
      info "Building app image..."
      docker build -t "$APP_IMAGE" "$REPO_ROOT"
    fi

    # NLP
    if ! docker image inspect "$NLP_IMAGE" &>/dev/null; then
      info "Building NLP image..."
      docker build -t "$NLP_IMAGE" -f "$REPO_ROOT/Dockerfile.langwatch_nlp" "$REPO_ROOT"
    fi

    # Langevals
    if ! docker image inspect "$LANGEVALS_IMAGE" &>/dev/null; then
      info "Building langevals image..."
      docker build -t "$LANGEVALS_IMAGE" -f "$REPO_ROOT/Dockerfile.langevals" "$REPO_ROOT"
    fi
  else
    info "SKIP_BUILD=true — using pre-built images"
  fi

  info "Loading images into Kind..."
  for img in "$CH_IMAGE" "$APP_IMAGE" "$NLP_IMAGE" "$LANGEVALS_IMAGE"; do
    if docker image inspect "$img" &>/dev/null; then
      kind load docker-image "$img" --name "$CLUSTER_NAME"
    else
      fail "Image $img not found — build it first or unset SKIP_BUILD"
    fi
  done
  pass "All images loaded into Kind"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Deploy full stack
# ─────────────────────────────────────────────────────────────────────────────
test_deploy() {
  sep; info "Suite: full-stack deployment"

  helm_install -f "$CHART_DIR/tests/values-e2e-full.yaml"
  pass "helm install (full stack)"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Pod health — verify every pod is running
# ─────────────────────────────────────────────────────────────────────────────
test_pod_health() {
  sep; info "Suite: pod health"

  # ClickHouse — 3 pods (replicated cluster with Keeper)
  for i in 0 1 2; do
    wait_ch_ready "${RELEASE}-clickhouse-${i}" 300
  done
  pass "ClickHouse cluster ready (3 pods)"

  # PostgreSQL
  wait_pod_ready "app.kubernetes.io/component=postgresql" 120
  pass "PostgreSQL pod ready"

  # Redis
  wait_pod_ready "app.kubernetes.io/component=redis" 120
  pass "Redis pod ready"

  # App
  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-app" 300
  pass "App pod ready"

  # Workers (2 replicas)
  local worker_count=0 attempts=0
  while [[ "$worker_count" -lt 2 ]] && [[ $attempts -lt 60 ]]; do
    worker_count=$(kc get pods \
      -l "app.kubernetes.io/name=${RELEASE}-workers" \
      --field-selector=status.phase=Running \
      -o name 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$worker_count" -lt 2 ]]; then
      sleep 5; attempts=$((attempts + 1))
    fi
  done
  assert_eq "Workers running" "$worker_count" "2"

  # NLP
  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-langwatch-nlp" 300
  pass "NLP pod ready"

  # Langevals
  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-langevals" 300
  pass "Langevals pod ready"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Service health — verify health endpoints and basic connectivity
# ─────────────────────────────────────────────────────────────────────────────
test_service_health() {
  sep; info "Suite: service health endpoints"

  local app_pod
  app_pod=$(kc get pod \
    -l "app.kubernetes.io/name=${RELEASE}-app" \
    -o jsonpath='{.items[0].metadata.name}')

  # App /api/health → 204
  local http_code
  http_code=$(kc exec "$app_pod" -- \
    curl -sf -o /dev/null -w '%{http_code}' http://localhost:5560/api/health)
  assert_eq "App /api/health → 204" "$http_code" "204"

  # NLP /health via service
  http_code=$(kc exec "$app_pod" -- \
    curl -sf -o /dev/null -w '%{http_code}' \
    "http://${RELEASE}-langwatch-nlp:5561/health")
  assert_eq "NLP /health → 200" "$http_code" "200"

  # Langevals /healthcheck via service
  http_code=$(kc exec "$app_pod" -- \
    curl -sf -o /dev/null -w '%{http_code}' \
    "http://${RELEASE}-langevals:5562/healthcheck")
  assert_eq "Langevals /healthcheck → 200" "$http_code" "200"

  # ClickHouse — query each replica
  for i in 0 1 2; do
    assert_eq "ClickHouse-${i} SELECT 1" \
      "$(ch_query "${RELEASE}-clickhouse-${i}" 'SELECT 1')" "1"
  done

  # PostgreSQL
  local pg_pod
  pg_pod=$(kc get pod \
    -l "app.kubernetes.io/component=postgresql" \
    -o jsonpath='{.items[0].metadata.name}')
  assert_eq "PostgreSQL SELECT 1" "$(pg_query "$pg_pod" 'SELECT 1')" "1"

  # Redis
  local redis_pod
  redis_pod=$(kc get pod \
    -l "app.kubernetes.io/component=redis" \
    -o jsonpath='{.items[0].metadata.name}')
  local pong
  pong=$(kc exec "$redis_pod" -- redis-cli ping)
  assert_eq "Redis PING → PONG" "$pong" "PONG"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: API integration — seed database and send a trace
# ─────────────────────────────────────────────────────────────────────────────
test_api() {
  sep; info "Suite: API integration"

  local app_pod
  app_pod=$(kc get pod \
    -l "app.kubernetes.io/name=${RELEASE}-app" \
    -o jsonpath='{.items[0].metadata.name}')

  # Seed org + project via prisma (HOME=/tmp for read-only rootfs)
  local api_key="e2e-full-stack-test-key"
  info "Seeding database..."
  kc exec "$app_pod" -- \
    sh -c "cd /app/langwatch && HOME=/tmp LANGWATCH_API_KEY=$api_key pnpm prisma:seed"
  pass "Database seeded (org + project)"

  # Send a trace to the collector API
  info "Sending trace to collector..."
  local http_code
  http_code=$(kc exec "$app_pod" -- \
    curl -s -o /dev/null -w '%{http_code}' \
    -X POST http://localhost:5560/api/collector \
    -H 'Content-Type: application/json' \
    -H "X-Auth-Token: $api_key" \
    -d '{"trace_id":"e2e-full-trace-001","spans":[{"type":"llm","span_id":"e2e-full-span-001","trace_id":"e2e-full-trace-001","name":"e2e-full-stack-test","model":"gpt-5-mini","input":{"type":"text","value":"hello from full-stack e2e"},"output":{"type":"text","value":"hello back"},"timestamps":{"started_at":1700000000000,"finished_at":1700000001000}}]}')
  assert_eq "Collector accepted trace" "$http_code" "200"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Log health — scan pod logs for fatal errors
# ─────────────────────────────────────────────────────────────────────────────
test_logs() {
  sep; info "Suite: log health check"

  # Pattern: truly fatal signals only (avoid false positives from normal warnings)
  local fatal_re='FATAL|panic:|SIGSEGV|unhandledRejection'

  check_logs() {
    local label="$1" selector="$2"
    for pod in $(kc get pods -l "$selector" -o jsonpath='{.items[*].metadata.name}'); do
      if kc logs "$pod" --tail=200 2>&1 | grep -qEi "$fatal_re"; then
        warn "$label ($pod) logs contain potential errors:"
        kc logs "$pod" --tail=200 2>&1 | grep -Ei "$fatal_re" | head -5
        fail "$label ($pod) has fatal log entries"
      else
        pass "$label ($pod) logs clean"
      fi
    done
  }

  check_logs "App"      "app.kubernetes.io/name=${RELEASE}-app"
  check_logs "Workers"  "app.kubernetes.io/name=${RELEASE}-workers"
  check_logs "NLP"      "app.kubernetes.io/name=${RELEASE}-langwatch-nlp"
  check_logs "Langevals" "app.kubernetes.io/name=${RELEASE}-langevals"
}

# ─────────────────────────────────────────────────────────────────────────────
main() {
  setup_kind
  build_and_load_images
  wait_api

  test_deploy
  test_pod_health
  test_service_health
  test_api
  test_logs

  sep
  pass "All full-stack E2E tests passed"
}

main "$@"
