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
#   IMAGE                   — override the Docker image tag (default: langwatch/clickhouse-serverless:next)

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-ch-test}"
RELEASE="ch"
NAMESPACE="ch-test"
CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER_DIR="$(cd "$(dirname "$0")/../../../infra/clickhouse-serverless" && pwd)"
TIMEOUT="${TIMEOUT:-480}"
IMAGE="${IMAGE:-langwatch/clickhouse-serverless:next}"

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

  # Exercise the production-shape operator-owned path: autogen.enabled=false
  # gates off the chart-managed Secret render entirely AND triggers the
  # preflight Job that validates the operator's Secret has the required keys.
  helm_install \
    -f "$CHART_DIR/tests/values-single.yaml" \
    --set autogen.enabled=false \
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

  # Helm's hook contract guarantees the pre-install preflight Job ran (and
  # succeeded) before this point — helm install blocks until the Job
  # completes, and the chart's hook-delete-policy=hook-succeeded cleans up
  # the Job + Role + RoleBinding + ServiceAccount immediately afterwards.
  # A failed preflight would have aborted helm_install with a non-zero exit
  # before this assertion ran. The negative case is exercised separately
  # by test_existing_secret_missing_key.

  # Verify the external secret is actually mounted and contains the expected value
  local pod="${RELEASE}-clickhouse-0"
  wait_ch_ready "$pod"

  local mounted_pw
  mounted_pw=$(kc exec "$pod" -- cat /mnt/secrets/password 2>/dev/null || echo "")
  assert_eq "Mounted password matches external secret" "$mounted_pw" "externally-managed"

  # Verify ClickHouse authenticates with the externally-managed password
  local query_result
  query_result=$(kc exec "$pod" -- \
    clickhouse-client --password="externally-managed" --query="SELECT 1" 2>/dev/null || echo "")
  assert_eq "Query with external password succeeds" "$query_result" "1"

  helm_uninstall
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: existing secret missing the required key (preflight blocks)
# Verifies: preflight Job hard-fails helm install when the operator-owned
# Secret is missing a key the StatefulSet would mount.
# ─────────────────────────────────────────────────────────────────────────────
test_existing_secret_missing_key() {
  sep; info "Suite: existing secret missing required key (preflight blocks)"

  kubectl --context "$KUBE_CTX" create namespace "$NAMESPACE" 2>/dev/null || true
  kc delete secret ch-creds-broken 2>/dev/null || true
  kc create secret generic ch-creds-broken \
    --from-literal=wrongkey="not-the-password"

  # helm install should FAIL: preflight detects the password key is missing.
  # NOTE: the actionable error message lives in the preflight Job's pod logs,
  # not in helm's stdout (helm just reports the hook exited non-zero). The
  # chart's hook-delete-policy=before-hook-creation,hook-succeeded keeps the
  # failed Job around so we can fetch its logs here.
  if helm_install \
    -f "$CHART_DIR/tests/values-single.yaml" \
    --set autogen.enabled=false \
    --set auth.existingSecret=ch-creds-broken \
    --set auth.secretKeys.passwordKey=password \
    --set auth.password="" 2>&1; then
    fail "Expected helm install to fail when preflight detects missing key"
  else
    pass "Preflight blocked install on missing key"
  fi

  # Drain the preflight Job's pod logs (job/<name> selector covers all pods
  # the Job ever spawned, regardless of which one currently exists). The
  # --tail=-1 forces the full buffer rather than the kubectl default tail.
  kc logs --tail=-1 "job/ch-clickhouse-preflight-secrets" > /tmp/ch-preflight-out 2>/dev/null || true

  if grep -q "preflight: required Secret keys missing" /tmp/ch-preflight-out; then
    pass "Preflight surfaced the missing-key error to the operator"
  else
    fail "Preflight error message not found in Job logs"
  fi

  # Clean up any partial release state so the next suite starts fresh.
  helm_uninstall || true
  kc delete secret ch-creds-broken 2>/dev/null || true
}

# ─────────────────────────────────────────────────────────────────────────────
# SUITE: stock install without autogen or existingSecret fails at render
# Verifies: chart-time validateAuth catches the "no Secret configured" footgun.
# ─────────────────────────────────────────────────────────────────────────────
test_no_auth_config_fails() {
  sep; info "Suite: no auth configured → chart-time render fail"

  if helm template ch "$CHART_DIR" 2>&1 | tee /tmp/ch-validate-out; then
    fail "Expected helm template to fail when neither autogen nor existingSecret is set"
  else
    pass "Chart render hard-failed on missing auth config"
  fi

  if grep -q "no credentials Secret configured" /tmp/ch-validate-out; then
    pass "validateAuth surfaced the actionable error"
  else
    fail "validateAuth error message not found in helm template output"
  fi
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

  test_replicated_access_config_applied
  test_replicated_access_entity_visible_everywhere
  test_replicated_named_collection_visible_everywhere
  test_replicated_recreated_replica_keeps_access

  # Best-effort teardown of the probe entities.
  ch_query "$pod" "DROP ROW POLICY IF EXISTS e2e_access_probe_policy ON e2e.events" || true
  ch_query "$pod" "DROP ROW POLICY IF EXISTS e2e_access_probe_allow_others ON e2e.events" || true
  ch_query "$pod" "DROP NAMED COLLECTION IF EXISTS e2e_probe_collection" || true
  ch_query "$pod" "DROP USER IF EXISTS e2e_access_probe" || true

  helm_uninstall
  pass "helm uninstall (3-node)"
}

# The preprocessed config is what the server actually merged, not what the
# chart wrote. Asserting on it is the only way to catch the inert-merge trap:
# without the `replace` attribute the block merges with the server default and
# `<local_directory>` survives, so entities keep landing node-local while the
# rendered file still looks correct.
#
# @scenario "Every replica starts with the keeper-backed access configuration applied"
test_replicated_access_config_applied() {
  local pod="${RELEASE}-clickhouse-0"
  local pod1="${RELEASE}-clickhouse-1"
  local pod2="${RELEASE}-clickhouse-2"

  local merged_pod merged_config
  for merged_pod in "$pod" "$pod1" "$pod2"; do
    wait_ch_ready "$merged_pod"
    merged_config=$(kc exec "$merged_pod" -- \
      cat /var/lib/clickhouse/preprocessed_configs/config.xml)

    if ! grep -qE '<user_directories[^>]+replace=' <<< "$merged_config"; then
      fail "$merged_pod: merged config has no <user_directories> with a replace attribute"
    fi
    if ! grep -q '<replicated>' <<< "$merged_config"; then
      fail "$merged_pod: merged config has no <replicated> user directory"
    fi
    if ! grep -q '<zookeeper_path>/clickhouse/langwatch/access/</zookeeper_path>' <<< "$merged_config"; then
      fail "$merged_pod: replicated user directory does not point at the cluster access path"
    fi
    if grep -q '<local_directory>' <<< "$merged_config"; then
      fail "$merged_pod: default <local_directory> survived the merge — @replace did not take effect"
    fi
    if ! grep -q '<named_collections_storage>' <<< "$merged_config"; then
      fail "$merged_pod: merged config has no <named_collections_storage>"
    fi
    if ! grep -qE '<named_collections_storage>.*<type>zookeeper</type>' \
         <<< "$(tr -d '\n' <<< "$merged_config")"; then
      fail "$merged_pod: named collections storage is not keeper-backed"
    fi
    pass "$merged_pod applied the keeper-backed access configuration"
  done
}

# Deliberately plain SQL, no ON CLUSTER: replication here is a property of the
# keeper-backed access storage, and an ON CLUSTER DDL would create the entity on
# each node independently and pass even with the storage misconfigured.
#
# @scenario "An access entity created on one replica is visible on every replica"
test_replicated_access_entity_visible_everywhere() {
  local pod="${RELEASE}-clickhouse-0"
  local pod1="${RELEASE}-clickhouse-1"
  local pod2="${RELEASE}-clickhouse-2"

  ch_query "$pod" "CREATE USER IF NOT EXISTS e2e_access_probe IDENTIFIED WITH no_password"
  ch_query "$pod" "GRANT SELECT ON e2e.events TO e2e_access_probe"
  ch_query "$pod" "
    CREATE ROW POLICY IF NOT EXISTS e2e_access_probe_policy ON e2e.events
      USING msg = 'no such message' TO e2e_access_probe"
  # Row visibility is an OR over the permissive policies that APPLY to the user,
  # so once any policy exists on a table every user not covered by one sees zero
  # rows. Without this counter-policy the probe policy would also blank the admin
  # and the enforcement assertions below could not tell the two users apart.
  ch_query "$pod" "
    CREATE ROW POLICY IF NOT EXISTS e2e_access_probe_allow_others ON e2e.events
      USING 1 TO ALL EXCEPT e2e_access_probe"
  pass "access entities created on pod-0 (no ON CLUSTER)"

  local other_pod attempts
  for other_pod in "$pod1" "$pod2"; do
    attempts=0
    until [[ $(ch_query "$other_pod" \
                "SELECT count() FROM system.users WHERE name = 'e2e_access_probe'") == "1" ]] \
          || [[ $attempts -ge 12 ]]; do
      sleep 5; attempts=$((attempts + 1))
    done
    assert_eq "User replicated to $other_pod" \
      "$(ch_query "$other_pod" \
          "SELECT count() FROM system.users WHERE name = 'e2e_access_probe'")" "1"
    # Both policies, not just the restrictive one: the enforcement assertions
    # below depend on the counter-policy having landed here too, and asserting
    # only the first would let them race a half-replicated pair.
    attempts=0
    until [[ $(ch_query "$other_pod" \
                "SELECT count() FROM system.row_policies WHERE short_name LIKE 'e2e_access_probe%'") == "2" ]] \
          || [[ $attempts -ge 12 ]]; do
      sleep 5; attempts=$((attempts + 1))
    done
    assert_eq "Row policies replicated to $other_pod" \
      "$(ch_query "$other_pod" \
          "SELECT count() FROM system.row_policies WHERE short_name LIKE 'e2e_access_probe%'")" "2"
  done

  # Enforcement on a replica that never ran the DDL. Catalog visibility alone
  # would still pass if the policy replicated but was not applied at query time.
  assert_eq "Admin sees the row on pod-2" \
    "$(ch_query "$pod2" 'SELECT count() FROM e2e.events')" "1"
  local probe_visible
  probe_visible=$(kc exec "$pod2" -- \
    clickhouse-client --user e2e_access_probe -q 'SELECT count() FROM e2e.events')
  assert_eq "Row policy filters the probe user on pod-2" "$probe_visible" "0"
}

# @scenario "A named collection created on one replica is visible on every replica"
test_replicated_named_collection_visible_everywhere() {
  local pod="${RELEASE}-clickhouse-0"
  local pod1="${RELEASE}-clickhouse-1"
  local pod2="${RELEASE}-clickhouse-2"

  ch_query "$pod1" "CREATE NAMED COLLECTION IF NOT EXISTS e2e_probe_collection AS k = 'v'"
  pass "named collection created on pod-1"

  local other_pod attempts
  for other_pod in "$pod" "$pod2"; do
    attempts=0
    until [[ $(ch_query "$other_pod" \
                "SELECT count() FROM system.named_collections WHERE name = 'e2e_probe_collection'") == "1" ]] \
          || [[ $attempts -ge 12 ]]; do
      sleep 5; attempts=$((attempts + 1))
    done
    assert_eq "Named collection replicated to $other_pod" \
      "$(ch_query "$other_pod" \
          "SELECT count() FROM system.named_collections WHERE name = 'e2e_probe_collection'")" "1"
  done
}

# Nothing re-creates the entities between the delete and the assertions: a fresh
# pod reads them out of keeper, which is what makes scaling the replica count
# safe.
#
# @scenario "A recreated replica reports existing access entities without re-provisioning"
test_replicated_recreated_replica_keeps_access() {
  local pod2="${RELEASE}-clickhouse-2"

  kc delete pod "$pod2" --wait=true
  wait_pod_ready "app.kubernetes.io/name=${RELEASE}-clickhouse" "$TIMEOUT"
  wait_ch_ready "$pod2"

  assert_eq "Recreated pod-2 still reports the user" \
    "$(ch_query "$pod2" \
        "SELECT count() FROM system.users WHERE name = 'e2e_access_probe'")" "1"
  assert_eq "Recreated pod-2 still reports the named collection" \
    "$(ch_query "$pod2" \
        "SELECT count() FROM system.named_collections WHERE name = 'e2e_probe_collection'")" "1"
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

  # Pre-pull the preflight Job's image into Kind so the (cold) pull does not
  # eat the Job's activeDeadlineSeconds budget on first run. alpine/k8s is
  # ~200MB; on a fresh Kind node the first pull regularly exceeds 60s on
  # slower connections. On EKS / managed clusters the image is typically
  # cached at the node group, so the chart default of 60s is fine in prod.
  local preflight_image
  preflight_image="${PREFLIGHT_IMAGE:-alpine/k8s:1.30.0}"
  info "Pre-pulling preflight image: $preflight_image"
  docker pull "$preflight_image" >/dev/null
  kind load docker-image "$preflight_image" --name "$CLUSTER_NAME"
}

main() {
  setup_kind
  build_and_load_image

  test_single
  test_upgrade
  test_existing_secret
  test_existing_secret_missing_key
  test_no_auth_config_fails
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
