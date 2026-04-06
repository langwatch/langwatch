#!/usr/bin/env bash
# E2E tests for the clickhouse-serverless Helm chart.
#
# Creates a Kind cluster, installs the chart in multiple modes (single-replica,
# upgrade, existing-secret, and optionally replicated), and verifies ClickHouse
# is functional in each case.
#
# Requirements: kind, helm, kubectl
# Environment:
#   KEEP_CLUSTER=true       — skip Kind cluster deletion on exit (debugging)
#   CLUSTER_NAME            — Kind cluster name (default: ch-test)
#   TIMEOUT                 — helm --wait timeout in seconds (default: 480)
#   TEST_REPLICATED=true    — also run the 3-node replicated suite
#   IMAGE                   — override the Docker image tag (default: langwatch/clickhouse-serverless:0.1.0)

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-ch-test}"
RELEASE="ch"
NAMESPACE="ch-test"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="$(cd "$(dirname "$0")/../../../clickhouse-serverless" && pwd)"
TIMEOUT="${TIMEOUT:-480}"
IMAGE="${IMAGE:-langwatch/clickhouse-serverless:0.1.0}"

# Source shared helpers
# shellcheck source=../../lib/test-helpers.sh
source "$(cd "$(dirname "$0")/../../lib" && pwd)/test-helpers.sh"

trap cleanup_cluster EXIT

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: single-replica
# Verifies: plain MergeTree engine, no Keeper pods, HTTP ping, DML roundtrip.
# ─────────────────────────────────────────────────────────────────────────────
test_single() {
  sep; info "Suite: single-replica"

  helm_install -f "$CHART_DIR/tests/values-single.yaml"
  pass "helm install"

  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  # HTTP /ping
  kc exec "$pod" -- \
    sh -c 'curl -sf http://localhost:8123/ping' | grep -q 'Ok\.' \
    && pass "HTTP /ping → Ok."

  # Basic query
  assert_eq "SELECT 1" "$(ch_query "$pod" 'SELECT 1')" "1"

  # Create table and verify engine is plain MergeTree (no Keeper for single node)
  ch_query "$pod" "CREATE DATABASE IF NOT EXISTS e2e"
  ch_query "$pod" "
    CREATE TABLE IF NOT EXISTS e2e.events (
      ts   DateTime,
      msg  String
    ) ENGINE=MergeTree() ORDER BY ts"
  local engine
  engine=$(ch_query "$pod" "
    SELECT engine FROM system.tables
    WHERE database = 'e2e' AND name = 'events'")
  assert_eq "Engine = MergeTree" "$engine" "MergeTree"

  # DML roundtrip
  ch_query "$pod" "INSERT INTO e2e.events VALUES (now(), 'hello from e2e')"
  assert_eq "Row count after INSERT" \
    "$(ch_query "$pod" 'SELECT count() FROM e2e.events')" "1"

  # No Keeper pods should exist for single-replica
  local keeper_count
  keeper_count=$(kc get pods \
    -l "app.kubernetes.io/name=${RELEASE}-clickhouse-keeper" \
    --no-headers 2>/dev/null | wc -l | tr -d ' ')
  assert_eq "No Keeper pods created" "$keeper_count" "0"

  # Secret exists with expected name
  kc get secret "${RELEASE}-clickhouse" &>/dev/null \
    && pass "Secret ${RELEASE}-clickhouse exists"

  helm_uninstall
  pass "helm uninstall"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: upgrade (password preserved)
# Verifies that helm upgrade does not regenerate the ClickHouse password.
# ─────────────────────────────────────────────────────────────────────────────
test_upgrade() {
  sep; info "Suite: upgrade — password preserved across helm upgrade"

  helm_install -f "$CHART_DIR/tests/values-single.yaml"
  pass "helm install"

  local pw_before
  pw_before=$(kc get secret "${RELEASE}-clickhouse" \
    -o jsonpath='{.data.password}' | base64 -d)

  hc upgrade "$RELEASE" "$CHART_DIR" \
    -f "$CHART_DIR/tests/values-single.yaml" \
    --wait --timeout "${TIMEOUT}s"
  pass "helm upgrade"

  local pw_after
  pw_after=$(kc get secret "${RELEASE}-clickhouse" \
    -o jsonpath='{.data.password}' | base64 -d)

  assert_eq "Password unchanged after upgrade" "$pw_after" "$pw_before"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: existing secret
# Verifies: chart uses an existing Kubernetes secret instead of creating one.
# ─────────────────────────────────────────────────────────────────────────────
test_existing_secret() {
  sep; info "Suite: existing secret"

  kubectl --context "$KUBE_CTX" create namespace "$NAMESPACE" 2>/dev/null || true
  kc create secret generic ch-creds \
    --from-literal=password="externally-managed" 2>/dev/null || true

  helm_install \
    -f "$CHART_DIR/tests/values-single.yaml" \
    --set auth.existingSecret=ch-creds \
    --set auth.secretKeys.passwordKey=password \
    --set auth.password=""

  pass "helm install with existing secret"

  # Chart should NOT have created its own secret
  if kc get secret "${RELEASE}-clickhouse" &>/dev/null; then
    fail "Chart-managed secret should not exist when existingSecret is set"
  else
    pass "No chart-managed secret created"
  fi

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: replicated (3 nodes + Keeper)
# Verifies: cluster topology, Keeper quorum, ReplicatedMergeTree, cross-replica DML.
# ─────────────────────────────────────────────────────────────────────────────
test_replicated() {
  sep; info "Suite: replicated (3 nodes + Keeper)"

  helm_install -f "$CHART_DIR/tests/values-replicated.yaml"
  pass "helm install (3-node)"

  # Keeper pods ready
  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-clickhouse-keeper" 180
  pass "Keeper pods ready"

  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  # Cluster topology: 1 shard × 3 replicas = 3 rows in system.clusters
  local replica_count
  replica_count=$(ch_query "$pod" \
    "SELECT count() FROM system.clusters WHERE cluster = 'langwatch'")
  assert_eq "Cluster 'langwatch' has 3 replicas" "$replica_count" "3"

  # ON CLUSTER DDL
  ch_query "$pod" "CREATE DATABASE IF NOT EXISTS e2e ON CLUSTER langwatch"
  ch_query "$pod" "
    CREATE TABLE IF NOT EXISTS e2e.events ON CLUSTER langwatch (
      ts   DateTime,
      msg  String
    ) ENGINE=ReplicatedMergeTree(
        '/clickhouse/tables/{shard}/{database}/{table}',
        '{replica}'
    ) ORDER BY ts"
  pass "ON CLUSTER DDL succeeded"

  # DML roundtrip on pod-0
  ch_query "$pod" "INSERT INTO e2e.events VALUES (now(), 'replicated hello')"
  assert_eq "Row count after INSERT" \
    "$(ch_query "$pod" 'SELECT count() FROM e2e.events')" "1"

  # Read from pod-1 to verify replication propagated
  local pod1="${RELEASE}-clickhouse-1"
  local attempts=0
  until [[ $(ch_query "$pod1" 'SELECT count() FROM e2e.events') == "1" ]] \
        || [[ $attempts -ge 12 ]]; do
    sleep 5; attempts=$((attempts + 1))
  done
  assert_eq "Row replicated to pod-1" \
    "$(ch_query "$pod1" 'SELECT count() FROM e2e.events')" "1"

  helm_uninstall
  pass "helm uninstall (3-node)"
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: cold storage config
# Verifies: storage policy and object disk are configured when cold.enabled=true.
# Uses skip_access_check so no real S3 is needed.
# ─────────────────────────────────────────────────────────────────────────────
test_cold_storage() {
  sep; info "Suite: cold storage configuration"

  helm_install -f "$CHART_DIR/tests/values-single.yaml" \
    --set cold.enabled=true \
    --set objectStorage.bucket=fake-bucket \
    --set objectStorage.region=us-east-1 \
    --set "objectStorage.endpoint=http://fake-s3:9000/fake-bucket/"

  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  # Verify storage policy exists
  local policy
  policy=$(ch_query "$pod" \
    "SELECT policy_name FROM system.storage_policies WHERE policy_name='local_primary' LIMIT 1")
  assert_eq "Storage policy local_primary exists" "$policy" "local_primary"

  # Verify object disk is configured
  local disk
  disk=$(ch_query "$pod" \
    "SELECT name FROM system.disks WHERE name='object' LIMIT 1")
  assert_eq "Object disk exists" "$disk" "object"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: backup config
# Verifies: backups disk configured, CronJobs created when backup.enabled=true.
# ─────────────────────────────────────────────────────────────────────────────
test_backup() {
  sep; info "Suite: backup configuration"

  helm_install -f "$CHART_DIR/tests/values-single.yaml" \
    --set backup.enabled=true \
    --set backup.database=langwatch \
    --set objectStorage.bucket=fake-bucket \
    --set objectStorage.region=us-east-1 \
    --set "objectStorage.endpoint=http://fake-s3:9000/fake-bucket/"

  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  # Verify backups disk is configured
  local disk
  disk=$(ch_query "$pod" \
    "SELECT name FROM system.disks WHERE name='backups' LIMIT 1")
  assert_eq "Backups disk exists" "$disk" "backups"

  # Verify backup CronJobs were created
  local full_cj
  full_cj=$(kc get cronjob "${RELEASE}-clickhouse-backup-full" -o name 2>/dev/null || echo "")
  assert_eq "Full backup CronJob exists" "$full_cj" "cronjob.batch/${RELEASE}-clickhouse-backup-full"

  local incr_cj
  incr_cj=$(kc get cronjob "${RELEASE}-clickhouse-backup-incremental" -o name 2>/dev/null || echo "")
  assert_eq "Incremental backup CronJob exists" "$incr_cj" "cronjob.batch/${RELEASE}-clickhouse-backup-incremental"

  local restore_cj
  restore_cj=$(kc get cronjob "${RELEASE}-clickhouse-restore-template" -o name 2>/dev/null || echo "")
  assert_eq "Restore template CronJob exists" "$restore_cj" "cronjob.batch/${RELEASE}-clickhouse-restore-template"

  # Verify restore template is suspended
  local suspended
  suspended=$(kc get cronjob "${RELEASE}-clickhouse-restore-template" -o jsonpath='{.spec.suspend}')
  assert_eq "Restore template is suspended" "$suspended" "true"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
build_and_load_image() {
  info "Building Docker image: $IMAGE"
  docker build -t "$IMAGE" "$DOCKER_DIR"
  info "Loading image into Kind cluster: $CLUSTER_NAME"
  kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"
}

main() {
  setup_kind
  build_and_load_image

  test_single
  test_upgrade
  test_existing_secret
  test_cold_storage
  test_backup

  if [[ "${TEST_REPLICATED:-false}" == "true" ]]; then
    test_replicated
  else
    info "Skipping replicated suite (set TEST_REPLICATED=true to enable)"
  fi

  sep
  pass "All clickhouse-serverless tests passed"
}

main "$@"
