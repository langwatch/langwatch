#!/usr/bin/env bash
# E2E tests for the overlay values system.
#
# Validates that every overlay combination renders correctly and that key
# overlay combos produce the expected Kubernetes resources when installed.
#
# Requirements: kind, helm, kubectl, docker
# Environment:
#   KEEP_CLUSTER=true  — skip Kind cluster deletion on exit
#   CLUSTER_NAME       — Kind cluster name (default: lw-overlay)
#   TIMEOUT            — helm --wait timeout in seconds (default: 300)

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-lw-overlay}"
RELEASE="lw"
NAMESPACE="lw-test"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT="${TIMEOUT:-300}"
OVERLAYS="${CHART_DIR}/examples/overlays"

# Source shared helpers
# shellcheck source=../../lib/test-helpers.sh
source "$(cd "$(dirname "$0")/../../lib" && pwd)/test-helpers.sh"

trap cleanup_cluster EXIT

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Render templates and capture output (no cluster needed)
tmpl() {
  helm template "$RELEASE" "$CHART_DIR" "$@" 2>&1
}

# Check rendered YAML contains a string
assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    pass "$label"
  else
    fail "$label: expected to find '$needle'"
  fi
}

# Check rendered YAML does NOT contain a string
assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    fail "$label: expected NOT to find '$needle'"
  else
    pass "$label"
  fi
}

# Count occurrences of a pattern in rendered YAML
count_matches() {
  local haystack="$1" pattern="$2"
  echo "$haystack" | grep -c "$pattern" || echo "0"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Template rendering — every overlay combo renders without error
# ─────────────────────────────────────────────────────────────────────────────
test_template_rendering() {
  sep; info "Suite: template rendering (all overlay combos)"

  local combos=(
    "size-minimal + nodeport"
    "size-dev + nodeport"
    "size-prod + ingress"
    "size-ha + ingress"
    "size-dev + nodeport + local-images"
    "size-prod + ingress + clickhouse-external"
    "size-prod + ingress + clickhouse-replicated"
    "size-prod + ingress + postgres-external"
    "size-prod + ingress + redis-external"
    "size-prod + ingress + postgres-external + redis-external"
    "size-ha + ingress + clickhouse-replicated + cold-storage-s3"
    "size-ha + ingress + postgres-external + redis-external + cold-storage-s3"
  )

  local flags_map
  declare -A flags_map=(
    ["size-minimal + nodeport"]="-f ${OVERLAYS}/size-minimal.yaml -f ${OVERLAYS}/access-nodeport.yaml"
    ["size-dev + nodeport"]="-f ${OVERLAYS}/size-dev.yaml -f ${OVERLAYS}/access-nodeport.yaml"
    ["size-prod + ingress"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml"
    ["size-ha + ingress"]="-f ${OVERLAYS}/size-ha.yaml -f ${OVERLAYS}/access-ingress.yaml"
    ["size-dev + nodeport + local-images"]="-f ${OVERLAYS}/size-dev.yaml -f ${OVERLAYS}/access-nodeport.yaml -f ${OVERLAYS}/local-images.yaml"
    ["size-prod + ingress + clickhouse-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/clickhouse-external.yaml"
    ["size-prod + ingress + clickhouse-replicated"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/clickhouse-replicated.yaml"
    ["size-prod + ingress + postgres-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/postgres-external.yaml"
    ["size-prod + ingress + redis-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/redis-external.yaml"
    ["size-prod + ingress + postgres-external + redis-external"]="-f ${OVERLAYS}/size-prod.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/postgres-external.yaml -f ${OVERLAYS}/redis-external.yaml"
    ["size-ha + ingress + clickhouse-replicated + cold-storage-s3"]="-f ${OVERLAYS}/size-ha.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/clickhouse-replicated.yaml -f ${OVERLAYS}/cold-storage-s3.yaml --set clickhouse.objectStorage.bucket=test --set clickhouse.objectStorage.region=us-east-1"
    ["size-ha + ingress + postgres-external + redis-external + cold-storage-s3"]="-f ${OVERLAYS}/size-ha.yaml -f ${OVERLAYS}/access-ingress.yaml -f ${OVERLAYS}/postgres-external.yaml -f ${OVERLAYS}/redis-external.yaml -f ${OVERLAYS}/cold-storage-s3.yaml --set clickhouse.objectStorage.bucket=test --set clickhouse.objectStorage.region=us-east-1"
  )

  for combo in "${combos[@]}"; do
    local flags="${flags_map[$combo]}"
    # shellcheck disable=SC2086
    if tmpl --set autogen.enabled=true $flags > /dev/null; then
      pass "renders: $combo"
    else
      fail "render failed: $combo"
    fi
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Profile rendering — all-in-one profiles render without error
# ─────────────────────────────────────────────────────────────────────────────
test_profile_rendering() {
  sep; info "Suite: profile rendering"

  tmpl -f "${CHART_DIR}/examples/values-local.yaml" > /dev/null \
    && pass "renders: values-local.yaml" \
    || fail "render failed: values-local.yaml"

  tmpl -f "${CHART_DIR}/examples/values-hosted-prod.yaml" > /dev/null \
    && pass "renders: values-hosted-prod.yaml" \
    || fail "render failed: values-hosted-prod.yaml"

  tmpl -f "${CHART_DIR}/examples/values-scalable-prod.yaml" > /dev/null \
    && pass "renders: values-scalable-prod.yaml" \
    || fail "render failed: values-scalable-prod.yaml"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: access-nodeport — verify NodePort service and correct URLs
# ─────────────────────────────────────────────────────────────────────────────
test_access_nodeport() {
  sep; info "Suite: access-nodeport overlay"

  local out
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml")

  # Service type = NodePort
  assert_contains "Service type is NodePort" "$out" "type: NodePort"
  assert_contains "NodePort is 30560" "$out" "nodePort: 30560"

  # NEXTAUTH_URL uses port 30560
  assert_contains "NEXTAUTH_URL uses 30560" "$out" "http://localhost:30560"

  # No Ingress resource
  assert_not_contains "No Ingress created" "$out" "kind: Ingress"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: access-ingress — verify Ingress, TLS, and no NodePort
# ─────────────────────────────────────────────────────────────────────────────
test_access_ingress() {
  sep; info "Suite: access-ingress overlay"

  local out
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")

  # Ingress resource created
  assert_contains "Ingress created" "$out" "kind: Ingress"
  assert_contains "Ingress class is nginx" "$out" "ingressClassName: nginx"
  assert_contains "TLS secret configured" "$out" "secretName: langwatch-tls"
  assert_contains "Ingress host set" "$out" "langwatch.example.com"

  # Backend auto-wired to app service
  assert_contains "Backend → lw-app" "$out" "name: ${RELEASE}-app"

  # Service type = ClusterIP (default, not NodePort)
  assert_not_contains "No NodePort" "$out" "type: NodePort"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: size overlays — verify replica counts and resource sizing
# ─────────────────────────────────────────────────────────────────────────────
test_size_overlays() {
  sep; info "Suite: size overlays"

  # size-minimal: workers disabled, 1 replica each
  local min_out
  min_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-minimal.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml")
  assert_not_contains "minimal: workers disabled" "$min_out" "kind: Deployment.*workers"
  assert_contains "minimal: app replicas 1" "$min_out" "replicas: 1"

  # size-prod: 2 app replicas, PDB
  local prod_out
  prod_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")
  assert_contains "prod: has PodDisruptionBudget" "$prod_out" "kind: PodDisruptionBudget"
  assert_contains "prod: workers enabled" "$prod_out" "name: ${RELEASE}-workers"

  # size-ha: 3 replicas, ClickHouse replicated
  local ha_out
  ha_out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-ha.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")
  assert_contains "ha: 3 CH replicas" "$ha_out" "replicas: 3"
  assert_contains "ha: Keeper StatefulSet" "$ha_out" "name: ${RELEASE}-clickhouse-keeper"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: infrastructure overlays — verify external DB wiring
# ─────────────────────────────────────────────────────────────────────────────
test_infra_overlays() {
  sep; info "Suite: infrastructure overlays"

  # clickhouse-external: no CH StatefulSet, CLICKHOUSE_URL from external
  local ch_ext
  ch_ext=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/clickhouse-external.yaml")
  assert_not_contains "ext-ch: no CH StatefulSet" "$ch_ext" "clickhouse-serverless/templates"
  assert_contains "ext-ch: CLICKHOUSE_URL env" "$ch_ext" "name: CLICKHOUSE_URL"

  # postgres-external: DATABASE_URL from secret
  local pg_ext
  pg_ext=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/postgres-external.yaml")
  assert_contains "ext-pg: DATABASE_URL from secretKeyRef" "$pg_ext" "name: langwatch-db"

  # redis-external: REDIS_URL from secret
  local redis_ext
  redis_ext=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/redis-external.yaml")
  assert_contains "ext-redis: REDIS_URL from secretKeyRef" "$redis_ext" "name: langwatch-redis"

  # clickhouse-replicated: Keeper StatefulSet + 3 replicas
  local ch_repl
  ch_repl=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${OVERLAYS}/clickhouse-replicated.yaml")
  assert_contains "repl-ch: Keeper created" "$ch_repl" "name: ${RELEASE}-clickhouse-keeper"
  assert_contains "repl-ch: CLICKHOUSE_CLUSTER env" "$ch_repl" "name: CLICKHOUSE_CLUSTER"

  # local-images: pullPolicy Never
  local local_img
  local_img=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${OVERLAYS}/local-images.yaml")
  assert_contains "local-images: pullPolicy Never" "$local_img" "imagePullPolicy: Never"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: overlay stacking — later overlays override earlier ones
# ─────────────────────────────────────────────────────────────────────────────
test_overlay_stacking() {
  sep; info "Suite: overlay stacking (last -f wins)"

  # size-dev sets 1 replica, then we override to 3 via --set
  local out
  out=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    --set app.replicaCount=3)
  assert_contains "stacking: --set overrides overlay" "$out" "replicas: 3"

  # size-dev + access-nodeport, then access-ingress overrides
  local stacked
  stacked=$(tmpl --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml")
  assert_contains "stacking: ingress overrides nodeport" "$stacked" "kind: Ingress"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — deploy size-dev + nodeport and verify live resources
# ─────────────────────────────────────────────────────────────────────────────
test_install_dev_nodeport() {
  sep; info "Suite: install size-dev + access-nodeport"

  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-dev.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml"
  pass "helm install (dev + nodeport)"

  # Verify service type
  local svc_type
  svc_type=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.type}')
  assert_eq "App service type is NodePort" "$svc_type" "NodePort"

  # Verify NodePort value
  local node_port
  node_port=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.ports[0].nodePort}')
  assert_eq "App NodePort is 30560" "$node_port" "30560"

  # Verify ClickHouse pod is running
  wait_ch_ready "${RELEASE}-clickhouse-0"
  pass "ClickHouse-0 ready"

  # Verify PostgreSQL is up
  wait_pod_ready "app.kubernetes.io/component=postgresql" 120
  pass "PostgreSQL ready"

  # Verify Redis is up
  wait_pod_ready "app.kubernetes.io/component=redis" 120
  pass "Redis ready"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — deploy size-minimal and verify minimal resources
# ─────────────────────────────────────────────────────────────────────────────
test_install_minimal() {
  sep; info "Suite: install size-minimal + access-nodeport"

  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-minimal.yaml" \
    -f "${OVERLAYS}/access-nodeport.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml"
  pass "helm install (minimal + nodeport)"

  # Workers should NOT exist
  if kc get deployment "${RELEASE}-workers" &>/dev/null; then
    fail "Workers Deployment should not exist in size-minimal"
  else
    pass "Workers Deployment absent (size-minimal)"
  fi

  # ClickHouse should be a single pod
  local ch_replicas
  ch_replicas=$(kc get statefulset "${RELEASE}-clickhouse" -o jsonpath='{.spec.replicas}')
  assert_eq "ClickHouse replicas = 1" "$ch_replicas" "1"

  # No Keeper (single node)
  if kc get statefulset "${RELEASE}-clickhouse-keeper" &>/dev/null; then
    fail "Keeper should not exist in size-minimal (single node)"
  else
    pass "No Keeper (single node)"
  fi

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — deploy size-prod + ingress and verify resources
# ─────────────────────────────────────────────────────────────────────────────
test_install_prod_ingress() {
  sep; info "Suite: install size-prod + access-ingress"

  # values-e2e.yaml sets replicaCount=0 for app/workers (no private images in CI).
  # Re-enable workers as a Deployment (0 replicas) to verify the resource is created.
  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml" \
    --set workers.enabled=true \
    --set workers.replicaCount=0
  pass "helm install (prod + ingress)"

  # Service type = ClusterIP
  local svc_type
  svc_type=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.type}')
  assert_eq "App service type is ClusterIP" "$svc_type" "ClusterIP"

  # Ingress exists
  kc get ingress "${RELEASE}-ingress" &>/dev/null \
    && pass "Ingress ${RELEASE}-ingress exists" \
    || fail "Ingress ${RELEASE}-ingress missing"

  # Ingress has TLS
  local tls_secret
  tls_secret=$(kc get ingress "${RELEASE}-ingress" \
    -o jsonpath='{.spec.tls[0].secretName}')
  assert_eq "Ingress TLS secret" "$tls_secret" "langwatch-tls"

  # Ingress backend auto-wired
  local backend_svc
  backend_svc=$(kc get ingress "${RELEASE}-ingress" \
    -o jsonpath='{.spec.rules[0].http.paths[0].backend.service.name}')
  assert_eq "Ingress backend → app" "$backend_svc" "${RELEASE}-app"

  # Workers Deployment created (0 replicas, but resource exists)
  kc get deployment "${RELEASE}-workers" &>/dev/null \
    && pass "Workers Deployment exists" \
    || fail "Workers Deployment missing"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — external ClickHouse overlay
# ─────────────────────────────────────────────────────────────────────────────
test_install_external_ch() {
  sep; info "Suite: install with clickhouse-external overlay"

  # clickhouse-external overlay must come AFTER values-e2e.yaml (which sets chartManaged=true)
  helm_install \
    --set autogen.enabled=true \
    -f "${OVERLAYS}/size-prod.yaml" \
    -f "${OVERLAYS}/access-ingress.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml" \
    -f "${OVERLAYS}/clickhouse-external.yaml"
  pass "helm install (prod + external CH)"

  # No ClickHouse StatefulSet
  if kc get statefulset "${RELEASE}-clickhouse" &>/dev/null; then
    fail "ClickHouse StatefulSet should not exist (external mode)"
  else
    pass "No ClickHouse StatefulSet (external)"
  fi

  # CLICKHOUSE_URL env set on app deployment
  local ch_url
  ch_url=$(kc get deployment "${RELEASE}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_URL")].value}')
  assert_contains "CLICKHOUSE_URL has external host" "$ch_url" "my-clickhouse"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Install — profile values-local.yaml
# ─────────────────────────────────────────────────────────────────────────────
test_install_profile_local() {
  sep; info "Suite: install profile values-local.yaml"

  helm_install -f "${CHART_DIR}/examples/values-local.yaml" \
    -f "${CHART_DIR}/tests/values-e2e.yaml"
  pass "helm install (values-local.yaml)"

  # NodePort
  local svc_type
  svc_type=$(kc get svc "${RELEASE}-app" -o jsonpath='{.spec.type}')
  assert_eq "Local profile: NodePort" "$svc_type" "NodePort"

  # ClickHouse running
  wait_ch_ready "${RELEASE}-clickhouse-0" 120
  pass "Local profile: ClickHouse ready"

  helm_uninstall
}

# ─── Image loading ────────────────────────────────────────────────────────────
load_images() {
  sep; info "Building and loading images for install tests"

  local ch_image="langwatch/clickhouse-serverless:0.1.0"
  local ch_dir="${CHART_DIR}/../../clickhouse-serverless"

  if ! docker image inspect "$ch_image" &>/dev/null 2>&1; then
    if [[ -f "$ch_dir/Dockerfile" ]]; then
      info "Building ClickHouse image: $ch_image"
      docker build -t "$ch_image" "$ch_dir"
    fi
  fi

  if docker image inspect "$ch_image" &>/dev/null 2>&1; then
    info "Loading $ch_image into Kind"
    kind load docker-image "$ch_image" --name "$CLUSTER_NAME"
  fi

  pass "Images loaded"
}

# ─────────────────────────────────────────────────────────────────────────────
main() {
  # Start fresh locally; in CI (KEEP_CLUSTER=true) the cluster is pre-created
  if [[ "${KEEP_CLUSTER:-false}" != "true" ]]; then
    kind delete cluster --name "$CLUSTER_NAME" 2>/dev/null || true
  fi

  setup_kind
  wait_api

  # Update chart dependencies
  helm dependency update "$CHART_DIR" > /dev/null 2>&1

  # Phase 1: Template rendering (fast, no deploy)
  test_template_rendering
  test_profile_rendering
  test_access_nodeport
  test_access_ingress
  test_size_overlays
  test_infra_overlays
  test_overlay_stacking

  # Phase 2: Live installs (slower, needs Kind + images)
  load_images
  test_install_dev_nodeport
  test_install_minimal
  test_install_prod_ingress
  test_install_external_ch
  test_install_profile_local

  sep
  pass "All overlay E2E tests passed"
}

main "$@"
