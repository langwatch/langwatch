#!/usr/bin/env bash
# E2E tests for the langwatch Helm chart.
#
# Deploys the full stack (ClickHouse, PostgreSQL, Redis, app, workers) to a
# Kind cluster and verifies each component is reachable and functional.
#
# Requirements: kind, helm, kubectl, docker
# Environment:
#   KEEP_CLUSTER=true  — skip Kind cluster deletion on exit (for debugging)
#   CLUSTER_NAME       — Kind cluster name (default: lw-test)
#   TIMEOUT            — helm --wait timeout in seconds (default: 480)
#   KEEP_CLUSTER and CLUSTER_NAME are passed through to test-helpers.sh

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-lw-test}"
RELEASE="lw"
NAMESPACE="lw-test"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT="${TIMEOUT:-480}"

# Source shared helpers
# shellcheck source=../../lib/test-helpers.sh
source "$(cd "$(dirname "$0")/../../lib" && pwd)/test-helpers.sh"

trap cleanup_cluster EXIT

# ─── PostgreSQL helper ───────────────────────────────────────────────────────
pg_query() {
  local pod="$1" query="$2"
  kc exec "$pod" -- \
    sh -c "PGPASSWORD=e2etest psql -U postgres -d langwatch -t -c \"$query\"" \
    | tr -d ' \n'
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: chart install
# ─────────────────────────────────────────────────────────────────────────────
test_install() {
  sep; info "Suite: chart install"

  helm_install -f "$CHART_DIR/tests/values-e2e.yaml"
  pass "helm install"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: ClickHouse
# ─────────────────────────────────────────────────────────────────────────────
test_clickhouse() {
  sep; info "Suite: ClickHouse"

  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  # HTTP ping directly inside the pod
  kc exec "$pod" -- \
    sh -c 'curl -sf http://localhost:8123/ping' | grep -q 'Ok\.' \
    && pass "ClickHouse HTTP /ping → Ok." \
    || fail "ClickHouse HTTP /ping failed"

  # Basic query
  assert_eq "SELECT 1" "$(ch_query "$pod" 'SELECT 1')" "1"

  # Create a table that mirrors the real langwatch schema pattern
  ch_query "$pod" "CREATE DATABASE IF NOT EXISTS langwatch"
  ch_query "$pod" "
    CREATE TABLE IF NOT EXISTS langwatch.spans (
      TraceId    String,
      SpanId     String,
      StartTime  DateTime64(3),
      TenantId   String
    ) ENGINE=MergeTree()
    ORDER BY (TenantId, TraceId, SpanId)"
  pass "Schema table created"

  # DML roundtrip
  ch_query "$pod" "TRUNCATE TABLE IF EXISTS langwatch.spans"
  ch_query "$pod" "
    INSERT INTO langwatch.spans VALUES
      ('t1', 's1', now64(), 'tenant-1'),
      ('t1', 's2', now64(), 'tenant-1')"
  local row_count
  row_count=$(ch_query "$pod" \
    "SELECT count() FROM langwatch.spans WHERE TenantId = 'tenant-1'")
  assert_eq "Tenant-scoped row count" "$row_count" "2"

  # Secret has expected name (the app deployment references ${RELEASE}-clickhouse)
  kc get secret "${RELEASE}-clickhouse" &>/dev/null \
    && pass "Secret ${RELEASE}-clickhouse exists" \
    || fail "Secret ${RELEASE}-clickhouse missing"

  # Headless service exists (required by StatefulSet)
  kc get svc "${RELEASE}-clickhouse-headless" &>/dev/null \
    && pass "Headless service ${RELEASE}-clickhouse-headless exists" \
    || fail "Headless service ${RELEASE}-clickhouse-headless missing"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────
test_postgresql() {
  sep; info "Suite: PostgreSQL"

  wait_pod_ready "app.kubernetes.io/component=postgresql"
  pass "PostgreSQL pod ready"

  local pod
  pod=$(kc get pod \
    -l "app.kubernetes.io/component=postgresql" \
    -o jsonpath='{.items[0].metadata.name}')

  local result
  result=$(pg_query "$pod" "SELECT 1")
  assert_eq "PostgreSQL SELECT 1" "$result" "1"

  kc get secret "${RELEASE}-postgresql" &>/dev/null \
    && pass "Secret ${RELEASE}-postgresql exists" \
    || fail "Secret ${RELEASE}-postgresql missing"

  kc get svc "${RELEASE}-postgresql" &>/dev/null \
    && pass "Service ${RELEASE}-postgresql exists" \
    || fail "Service ${RELEASE}-postgresql missing"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Redis
# ─────────────────────────────────────────────────────────────────────────────
test_redis() {
  sep; info "Suite: Redis"

  wait_pod_ready "app.kubernetes.io/component=redis"
  pass "Redis pod ready"

  local pod
  pod=$(kc get pod \
    -l "app.kubernetes.io/component=redis" \
    -o jsonpath='{.items[0].metadata.name}')

  local pong
  pong=$(kc exec "$pod" -- redis-cli ping)
  assert_eq "Redis PING → PONG" "$pong" "PONG"

  kc exec "$pod" -- redis-cli SET e2e:key "hello" > /dev/null
  local val
  val=$(kc exec "$pod" -- redis-cli GET e2e:key)
  assert_eq "Redis SET/GET roundtrip" "$val" "hello"

  kc get svc "${RELEASE}-redis-master" &>/dev/null \
    && pass "Service ${RELEASE}-redis-master exists" \
    || fail "Service ${RELEASE}-redis-master missing"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Kubernetes resources
# Verify services, deployments, and secrets have the names the app expects.
# ─────────────────────────────────────────────────────────────────────────────
test_resources() {
  sep; info "Suite: Kubernetes resources"

  for svc in \
    "${RELEASE}-clickhouse" \
    "${RELEASE}-clickhouse-headless" \
    "${RELEASE}-postgresql" \
    "${RELEASE}-redis-master"; do
    if kc get svc "$svc" &>/dev/null; then
      pass "Service $svc"
    else
      fail "Service $svc missing"
    fi
  done

  # App Deployment is created even with replicaCount=0
  if kc get deployment "${RELEASE}-app" &>/dev/null; then
    pass "Deployment ${RELEASE}-app"
  else
    fail "Deployment ${RELEASE}-app missing"
  fi

  # Workers Deployment absent (enabled: false)
  if kc get deployment "${RELEASE}-workers" &>/dev/null; then
    fail "Workers Deployment should not exist (enabled=false)"
  else
    pass "Workers Deployment absent (enabled=false)"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: ClickHouse URL secret — langwatch chart owns the secret
# ─────────────────────────────────────────────────────────────────────────────
test_clickhouse_url_secret() {
  sep; info "Suite: ClickHouse URL secret"

  local secret_name="${RELEASE}-clickhouse"

  # Secret must exist with all three keys
  kc get secret "$secret_name" &>/dev/null \
    && pass "Secret $secret_name exists" \
    || fail "Secret $secret_name missing"

  # Verify all required keys are present
  for key in password clusterSecret url; do
    local val
    val=$(kc get secret "$secret_name" -o jsonpath="{.data.${key}}" 2>/dev/null)
    if [[ -n "$val" ]]; then
      pass "Secret key '$key' present"
    else
      fail "Secret key '$key' missing from $secret_name"
    fi
  done

  # URL must contain the password
  local pw url
  pw=$(kc get secret "$secret_name" -o jsonpath='{.data.password}' | base64 -d)
  url=$(kc get secret "$secret_name" -o jsonpath='{.data.url}' | base64 -d)

  if echo "$url" | grep -qF "$pw"; then
    pass "URL contains the password"
  else
    fail "URL does not contain the password: url=$url"
  fi

  # URL must point at the chart-managed ClickHouse service
  local expected_host="${RELEASE}-clickhouse:8123"
  if echo "$url" | grep -qF "$expected_host"; then
    pass "URL points at $expected_host"
  else
    fail "URL does not contain $expected_host: url=$url"
  fi

  # App deployment must reference the secret via secretKeyRef (not inline value)
  local ref_name
  ref_name=$(kc get deployment "${RELEASE}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_URL")].valueFrom.secretKeyRef.name}' 2>/dev/null)
  assert_eq "App CLICKHOUSE_URL via secretKeyRef" "$ref_name" "$secret_name"

  local ref_key
  ref_key=$(kc get deployment "${RELEASE}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_URL")].valueFrom.secretKeyRef.key}' 2>/dev/null)
  assert_eq "App CLICKHOUSE_URL key = url" "$ref_key" "url"

  # No CLICKHOUSE_PASSWORD env var should be present (URL is self-contained)
  local ch_pw_env
  ch_pw_env=$(kc get deployment "${RELEASE}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_PASSWORD")].name}' 2>/dev/null)
  if [[ -z "$ch_pw_env" ]]; then
    pass "No CLICKHOUSE_PASSWORD env var (URL is self-contained)"
  else
    fail "CLICKHOUSE_PASSWORD env var should not exist in default mode"
  fi

  # Subchart must NOT have created its own secret (langwatch chart owns it)
  # Verify by checking the secret's labels — should have langwatch labels, not subchart labels
  local managed_by
  managed_by=$(kc get secret "$secret_name" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/component}')
  assert_eq "Secret owned by langwatch chart (component=clickhouse)" "$managed_by" "clickhouse"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: helm upgrade — ClickHouse password and URL preserved
# ─────────────────────────────────────────────────────────────────────────────
test_upgrade() {
  sep; info "Suite: helm upgrade — ClickHouse credentials preserved"

  local pw_before url_before
  pw_before=$(kc get secret "${RELEASE}-clickhouse" \
    -o jsonpath='{.data.password}' | base64 -d)
  url_before=$(kc get secret "${RELEASE}-clickhouse" \
    -o jsonpath='{.data.url}' | base64 -d)

  hc upgrade "$RELEASE" "$CHART_DIR" \
    -f "$CHART_DIR/tests/values-e2e.yaml" \
    --wait --timeout "${TIMEOUT}s"
  pass "helm upgrade"

  local pw_after url_after
  pw_after=$(kc get secret "${RELEASE}-clickhouse" \
    -o jsonpath='{.data.password}' | base64 -d)
  url_after=$(kc get secret "${RELEASE}-clickhouse" \
    -o jsonpath='{.data.url}' | base64 -d)

  assert_eq "ClickHouse password unchanged after upgrade" "$pw_after" "$pw_before"
  assert_eq "ClickHouse URL unchanged after upgrade" "$url_after" "$url_before"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: external ClickHouse — no ClickHouse resources created
# ─────────────────────────────────────────────────────────────────────────────
test_external_clickhouse() {
  sep; info "Suite: external ClickHouse (chartManaged=false)"

  # Clean up the main release first
  helm_uninstall "$RELEASE"

  local ext_release="${RELEASE}-ext"

  # Install with a different release name directly (can't use helm_install which hardcodes RELEASE)
  wait_api
  hc upgrade "$ext_release" "$CHART_DIR" --install \
    -f "$CHART_DIR/tests/values-e2e.yaml" \
    --set clickhouse.chartManaged=false \
    --set clickhouse.external.url.value="http://fake-ch:8123/default" \
    --create-namespace --wait --atomic --timeout "${TIMEOUT}s"
  pass "helm install with external ClickHouse"

  # No ClickHouse StatefulSet or Secrets created
  kc get statefulset "${ext_release}-clickhouse" &>/dev/null \
    && fail "ClickHouse StatefulSet should not exist for external mode" \
    || pass "No ClickHouse StatefulSet (external mode)"

  kc get secret "${ext_release}-clickhouse" &>/dev/null \
    && fail "ClickHouse Secret should not exist for external mode" \
    || pass "No ClickHouse Secret (external mode)"

  # App Deployment should have CLICKHOUSE_URL env set to the external value (plain, not secretKeyRef)
  local ch_url
  ch_url=$(kc get deployment "${ext_release}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_URL")].value}')
  assert_eq "CLICKHOUSE_URL = external value" "$ch_url" "http://fake-ch:8123/default"

  # No secretKeyRef for CLICKHOUSE_URL in external mode
  local ch_url_ref
  ch_url_ref=$(kc get deployment "${ext_release}-app" \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CLICKHOUSE_URL")].valueFrom.secretKeyRef.name}' 2>/dev/null)
  if [[ -z "$ch_url_ref" ]]; then
    pass "No secretKeyRef for CLICKHOUSE_URL (external mode uses plain value)"
  else
    fail "CLICKHOUSE_URL should not use secretKeyRef in external mode"
  fi

  helm_uninstall "$ext_release"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: App health check
# Upgrades the release to enable the app (1 replica) and verifies /api/health.
# ─────────────────────────────────────────────────────────────────────────────
test_app() {
  sep; info "Suite: app health check"

  # Upgrade to enable the app with 1 replica, skip only ES migration (no ES in chart)
  hc upgrade "$RELEASE" "$CHART_DIR" \
    -f "$CHART_DIR/tests/values-e2e.yaml" \
    --set app.replicaCount=1 \
    --wait --timeout "${TIMEOUT}s"
  pass "helm upgrade (app enabled)"

  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-app" 180
  pass "App pod ready"

  local pod
  pod=$(kc get pod \
    -l "app.kubernetes.io/name=${RELEASE}-app" \
    -o jsonpath='{.items[0].metadata.name}')

  # The /api/health endpoint returns 204
  local http_code
  http_code=$(kc exec "$pod" -- \
    curl -sf -o /dev/null -w '%{http_code}' http://localhost:5560/api/health)
  assert_eq "App /api/health returns 204" "$http_code" "204"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: Workers health check
# Upgrades the release to enable workers and verifies the pod reaches Ready.
# Workers have no HTTP endpoint — reaching Running state is the health signal.
# ─────────────────────────────────────────────────────────────────────────────
test_workers() {
  sep; info "Suite: workers health check"

  hc upgrade "$RELEASE" "$CHART_DIR" \
    -f "$CHART_DIR/tests/values-e2e.yaml" \
    --set app.replicaCount=1 \
    --set workers.enabled=true \
    --set workers.replicaCount=1 \
    --wait --timeout "${TIMEOUT}s"
  pass "helm upgrade (workers enabled)"

  # Workers pod should be ready
  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-workers" 180
  pass "Workers pod ready"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: cold storage + backup (deploys RustFS as S3, verifies actual I/O)
# ─────────────────────────────────────────────────────────────────────────────
test_cold_storage_and_backup() {
  sep; info "Suite: cold storage + backup (with RustFS S3)"

  # Clean up previous release
  helm_uninstall "$RELEASE"

  # Deploy RustFS as an S3-compatible service in the cluster
  info "Deploying RustFS..."
  kc apply -f - <<'RUSTFS_EOF'
apiVersion: v1
kind: Pod
metadata:
  name: rustfs
  labels:
    app: rustfs
spec:
  containers:
    - name: rustfs
      image: rustfs/rustfs:latest
      args: ["server", "/data"]
      env:
        - name: RUSTFS_ROOT_USER
          value: "admin"
        - name: RUSTFS_ROOT_PASSWORD
          value: "adminpass"
      ports:
        - containerPort: 9000
---
apiVersion: v1
kind: Service
metadata:
  name: rustfs
spec:
  selector:
    app: rustfs
  ports:
    - port: 9000
      targetPort: 9000
RUSTFS_EOF

  # Wait for RustFS to be ready
  kc wait pod rustfs --for=condition=Ready --timeout=120s
  pass "RustFS ready"

  # Create the S3 bucket via a job
  kc run create-bucket --rm -i --restart=Never \
    --image=amazon/aws-cli:2.27.31 -- \
    sh -c 'AWS_ACCESS_KEY_ID=admin AWS_SECRET_ACCESS_KEY=adminpass aws --endpoint-url http://rustfs:9000 s3 mb s3://clickhouse 2>/dev/null; echo done' \
    || true
  pass "S3 bucket created"

  # Install chart with cold storage + backup enabled, pointing at RustFS
  helm_install -f "$CHART_DIR/tests/values-e2e.yaml" \
    --set 'clickhouse.objectStorage.bucket=clickhouse' \
    --set 'clickhouse.objectStorage.region=us-east-1' \
    --set 'clickhouse.objectStorage.endpoint=http://rustfs:9000/clickhouse/' \
    --set 'clickhouse.objectStorage.useEnvironmentCredentials=false' \
    --set 'clickhouse.objectStorage.credentials.secretKeyRef.name=' \
    --set 'clickhouse.cold.enabled=true' \
    --set 'clickhouse.cold.defaultTtlDays=49' \
    --set 'clickhouse.backup.enabled=true' \
    --set-string 'clickhouse.env.S3_ACCESS_KEY=admin' \
    --set-string 'clickhouse.env.S3_SECRET_KEY=adminpass'
  pass "helm install with cold storage + backup"

  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  # Verify storage policy exists
  local policy
  policy=$(ch_query "$pod" "SELECT policy_name FROM system.storage_policies WHERE policy_name='local_primary' LIMIT 1")
  assert_eq "Storage policy local_primary" "$policy" "local_primary"

  # Verify object disk exists
  local disk
  disk=$(ch_query "$pod" "SELECT name FROM system.disks WHERE name='object' LIMIT 1")
  assert_eq "Object disk exists" "$disk" "object"

  # Verify backups disk exists
  local bdisk
  bdisk=$(ch_query "$pod" "SELECT name FROM system.disks WHERE name='backups' LIMIT 1")
  assert_eq "Backups disk exists" "$bdisk" "backups"

  # --- Cold storage movement test ---
  info "Testing cold storage data movement..."
  ch_query "$pod" "CREATE TABLE default.cold_test (ts DateTime, msg String) ENGINE=MergeTree() ORDER BY ts TTL ts + INTERVAL 1 SECOND TO VOLUME 'cold' SETTINGS storage_policy='local_primary'"
  ch_query "$pod" "INSERT INTO default.cold_test VALUES ('2020-01-01 00:00:00','old1'),('2020-01-01 00:00:01','old2'),('2020-01-01 00:00:02','old3')"
  ch_query "$pod" "OPTIMIZE TABLE default.cold_test FINAL"
  sleep 3

  local cold_disk
  cold_disk=$(ch_query "$pod" "SELECT disk_name FROM system.parts WHERE table='cold_test' AND active LIMIT 1")
  assert_eq "Parts on cold disk" "$cold_disk" "object"

  local cold_count
  cold_count=$(ch_query "$pod" "SELECT count() FROM default.cold_test")
  assert_eq "Cold data readable" "$cold_count" "3"

  # --- Backup + restore test ---
  info "Testing native BACKUP/RESTORE..."
  ch_query "$pod" "CREATE TABLE default.backup_test (ts DateTime, value Int32) ENGINE=MergeTree() ORDER BY ts"
  ch_query "$pod" "INSERT INTO default.backup_test VALUES ('2025-01-01',100),('2025-01-02',200),('2025-01-03',300)"

  ch_query "$pod" "BACKUP DATABASE default TO Disk('backups','e2e-full/')"
  local bstatus
  bstatus=$(ch_query "$pod" "SELECT status FROM system.backups WHERE name LIKE '%e2e-full%' ORDER BY start_time DESC LIMIT 1")
  assert_eq "Backup status" "$bstatus" "BACKUP_CREATED"

  ch_query "$pod" "DROP TABLE default.backup_test SYNC"
  ch_query "$pod" "RESTORE DATABASE default FROM Disk('backups','e2e-full/') SETTINGS allow_non_empty_tables=true"

  local restored
  restored=$(ch_query "$pod" "SELECT sum(value) FROM default.backup_test")
  assert_eq "Restored checksum" "$restored" "600"

  # --- Incremental backup test ---
  ch_query "$pod" "INSERT INTO default.backup_test VALUES ('2025-01-04',400)"
  ch_query "$pod" "BACKUP DATABASE default TO Disk('backups','e2e-incr/') SETTINGS base_backup=Disk('backups','e2e-full/')"

  local incr_status
  incr_status=$(ch_query "$pod" "SELECT status FROM system.backups WHERE name LIKE '%e2e-incr%' ORDER BY start_time DESC LIMIT 1")
  assert_eq "Incremental backup" "$incr_status" "BACKUP_CREATED"

  # Clean up RustFS
  kc delete pod rustfs --force --grace-period=0 2>/dev/null || true
  kc delete svc rustfs 2>/dev/null || true

  helm_uninstall "$RELEASE"
  pass "Cold storage + backup suite passed"
}

# ─────────────────────────────────────────────────────────────────────────────
main() {
  local ch_values="${CHART_DIR}/../clickhouse-serverless/values.yaml"
  setup_kind "$ch_values"

  # Build and load the app image into Kind
  local app_repo app_tag app_image
  app_repo=$(helm show values "$CHART_DIR" | grep -A20 "^images:" | grep -A2 "^  app:" | grep "repository:" | awk '{print $2}')
  app_tag=$(helm show values "$CHART_DIR" | grep -A20 "^images:" | grep -A2 "^  app:" | grep "tag:" | head -1 | awk '{print $2}')
  app_image="${app_repo}:${app_tag}"
  if ! docker image inspect "$app_image" &>/dev/null 2>&1; then
    local repo_root="${CHART_DIR}/../.."
    if [[ -f "$repo_root/Dockerfile" ]]; then
      info "Building app image: $app_image"
      docker build -t "$app_image" "$repo_root"
    fi
  fi
  if docker image inspect "$app_image" &>/dev/null 2>&1; then
    info "Loading app image into Kind: $app_image"
    kind load docker-image "$app_image" --name "$CLUSTER_NAME"
  fi
  wait_api

  test_install
  test_clickhouse
  test_clickhouse_url_secret
  test_postgresql
  test_redis
  test_resources
  test_app
  test_workers
  test_upgrade
  test_external_clickhouse
  test_cold_storage_and_backup

  sep
  pass "All langwatch chart tests passed"
}

main "$@"
