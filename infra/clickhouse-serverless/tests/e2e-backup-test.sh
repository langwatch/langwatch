#!/usr/bin/env bash
# E2E test: exercises the shipped /scripts/backup-data.sh and /scripts/restore-data.sh
# via docker exec, exactly as the Helm CronJobs would run them, then the backup
# sidecar (ADR-191): a full that survives a sidecar restart, an incremental chained
# on it, and a restore. Uses RustFS as S3-compatible storage.
# Usage: ./tests/e2e-backup-test.sh [image:tag]
set -euo pipefail

IMAGE="${1:-clickhouse-serverless:test}"
NET="ch-backup-net"
CH="ch-backup"
S3="rustfs-backup"
S3_ACCESS_KEY="admin"
S3_SECRET_KEY="adminpass"
BUCKET="clickhouse"

cleanup() {
    echo "--- cleanup ---"
    docker rm -f "$CH" "$S3" 2>/dev/null || true
    docker network rm "$NET" 2>/dev/null || true
}
trap cleanup EXIT
cleanup

echo "=== Backup/Restore E2E test ==="
docker network create "$NET" 2>/dev/null || true

# --- Start RustFS (S3-compatible) ---
docker run -d --name "$S3" --network "$NET" \
    -p 9000:9000 \
    -e RUSTFS_ROOT_USER="$S3_ACCESS_KEY" \
    -e RUSTFS_ROOT_PASSWORD="$S3_SECRET_KEY" \
    rustfs/rustfs:latest server /data

echo "Waiting for RustFS..."
s3_ready=0
for i in $(seq 1 30); do
    if curl -so /dev/null --connect-timeout 3 --max-time 5 http://localhost:9000/ 2>/dev/null; then
        s3_ready=1; break
    fi
    sleep 1
done
if [ "$s3_ready" -ne 1 ]; then
    echo "FAIL: RustFS not healthy"; docker logs "$S3" 2>&1 | tail -20; exit 1
fi

docker run --rm --network "$NET" \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
    -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    amazon/aws-cli:2.27.31 \
    --endpoint-url "http://$S3:9000" s3 mb "s3://$BUCKET"
echo "RustFS ready"

S3_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$S3")

# --- Start ClickHouse with backup enabled ---
docker run -d --name "$CH" --network "$NET" \
    -p 18123:8123 \
    -e CH_CPU=2 \
    -e CH_RAM=2147483648 \
    -e CLICKHOUSE_PASSWORD=test123 \
    -e BACKUP_ENABLED=true \
    -e "S3_ENDPOINT=http://${S3_IP}:9000/${BUCKET}/" \
    -e "S3_ACCESS_KEY=${S3_ACCESS_KEY}" \
    -e "S3_SECRET_KEY=${S3_SECRET_KEY}" \
    -e S3_BUCKET="$BUCKET" \
    -e S3_REGION=us-east-1 \
    -e USE_ENVIRONMENT_CREDENTIALS=false \
    "$IMAGE"

echo "Waiting for ClickHouse..."
ready=0
for i in $(seq 1 60); do
    if curl -sf --connect-timeout 3 --max-time 5 'http://localhost:18123/ping' >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then
    echo "FAIL: ClickHouse not ready"; docker logs "$CH" 2>&1 | tail -50; exit 1
fi

# Helper: run SQL via HTTP (for data setup/verification only — not for backup/restore)
query() {
    local result
    result=$(curl -sf --connect-timeout 5 --max-time 30 "http://localhost:18123/?password=test123" --data "$1")
    if echo "$result" | grep -q "Code:"; then
        echo "QUERY ERROR: $result" >&2
        return 1
    fi
    echo "$result"
}

pass=0
fail=0
check() {
    local name="$1" q="$2" expect="$3"
    result=$(query "$q" | tr -d '[:space:]')
    if [ "$result" = "$expect" ]; then
        echo "  PASS: $name = $result"
        pass=$((pass + 1))
    else
        echo "  FAIL: $name = $result (expected $expect)"
        fail=$((fail + 1))
    fi
}

# Helper: run the shipped backup script inside the container
run_backup() {
    local mode="$1"
    docker exec \
        -e CLICKHOUSE_HOST=localhost \
        -e CLICKHOUSE_PASSWORD=test123 \
        -e BACKUP_MODE="$mode" \
        -e BACKUP_DATABASE=e2e \
        "$CH" /scripts/backup-data.sh
}

# Helper: run the shipped restore script inside the container
run_restore() {
    local backup_name="$1"
    docker exec \
        -e CLICKHOUSE_HOST=localhost \
        -e CLICKHOUSE_PASSWORD=test123 \
        -e BACKUP_DATABASE=e2e \
        -e BACKUP_NAME="$backup_name" \
        -e CONFIRM_RESTORE=yes \
        "$CH" /scripts/restore-data.sh
}

echo ""
echo "=== Phase 0: An incremental with no full ever writes nothing and exits 0 ==="

query "CREATE DATABASE IF NOT EXISTS e2e"
if run_backup incremental; then
    echo "  PASS: incremental with no full exited 0"
    pass=$((pass + 1))
else
    echo "  FAIL: incremental with no full should stand down with exit 0"
    fail=$((fail + 1))
fi
check "no incremental written without a full" \
    "SELECT count() FROM system.backups WHERE id LIKE 'e2e_incremental_%'" "0"

echo ""
echo "=== Phase 1: Create data and full backup ==="

query "CREATE TABLE e2e.events (
    ts DateTime,
    msg String,
    value Int32
) ENGINE = MergeTree() ORDER BY ts"

query "INSERT INTO e2e.events VALUES
    ('2025-01-01 00:00:00', 'event_a', 100),
    ('2025-01-01 00:00:01', 'event_b', 200),
    ('2025-01-01 00:00:02', 'event_c', 300)"

check "initial row count" "SELECT count() FROM e2e.events" "3"
check "initial checksum" "SELECT sum(value) FROM e2e.events" "600"

echo "  Running full backup via /scripts/backup-data.sh..."
run_backup full

check "backup status" \
    "SELECT status FROM system.backups WHERE id LIKE 'e2e_full_%' ORDER BY start_time DESC LIMIT 1" \
    "BACKUP_CREATED"

# Capture the full backup name for restore
FULL_BACKUP_NAME=$(query "SELECT id FROM system.backups WHERE id LIKE 'e2e_full_%' ORDER BY start_time DESC LIMIT 1" | tr -d '[:space:]')
echo "  Full backup name: ${FULL_BACKUP_NAME}"

echo ""
echo "=== Phase 2: Drop and restore ==="

query "DROP TABLE e2e.events SYNC"
check "table dropped" "SELECT count() FROM system.tables WHERE database='e2e' AND name='events'" "0"

echo "  Restoring via /scripts/restore-data.sh..."
run_restore "$FULL_BACKUP_NAME"

check "restored row count" "SELECT count() FROM e2e.events" "3"
check "restored checksum" "SELECT sum(value) FROM e2e.events" "600"

echo ""
echo "=== Phase 3: Incremental backup ==="

query "INSERT INTO e2e.events VALUES
    ('2025-01-01 00:00:03', 'event_d', 400),
    ('2025-01-01 00:00:04', 'event_e', 500)"

check "row count after insert" "SELECT count() FROM e2e.events" "5"

echo "  Running incremental backup via /scripts/backup-data.sh..."
run_backup incremental

check "incremental backup status" \
    "SELECT status FROM system.backups WHERE id LIKE 'e2e_incremental_%' ORDER BY start_time DESC LIMIT 1" \
    "BACKUP_CREATED"

INCR_BACKUP_NAME=$(query "SELECT id FROM system.backups WHERE id LIKE 'e2e_incremental_%' ORDER BY start_time DESC LIMIT 1" | tr -d '[:space:]')
echo "  Incremental backup name: ${INCR_BACKUP_NAME}"

# Verify incremental restore works
query "DROP TABLE e2e.events SYNC"
echo "  Restoring from incremental via /scripts/restore-data.sh..."
run_restore "$INCR_BACKUP_NAME"

check "incremental restored rows" "SELECT count() FROM e2e.events" "5"
check "incremental restored checksum" "SELECT sum(value) FROM e2e.events" "1500"

echo ""
echo "=== Phase 3b: A second incremental chains on the first ==="

query "INSERT INTO e2e.events VALUES ('2025-01-01 00:00:05', 'event_f', 600)"
sleep 1 # backup names have one-second resolution
run_backup incremental
INCR2_BACKUP_NAME=$(query "SELECT id FROM system.backups WHERE id LIKE 'e2e_incremental_%' AND status = 'BACKUP_CREATED' ORDER BY start_time DESC LIMIT 1" | tr -d '[:space:]')
if [ "$INCR2_BACKUP_NAME" = "$INCR_BACKUP_NAME" ]; then
    echo "  FAIL: no second incremental was written"
    fail=$((fail + 1))
fi
query "SYSTEM FLUSH LOGS"
check "second incremental is based on the first" \
    "SELECT countIf(query LIKE '%base_backup = Disk(\\'backups\\', \\'${INCR_BACKUP_NAME}\\')%') > 0 FROM system.query_log WHERE query LIKE 'BACKUP DATABASE%${INCR2_BACKUP_NAME}%' SETTINGS log_queries = 0" "1"
query "DROP TABLE e2e.events SYNC"
run_restore "$INCR2_BACKUP_NAME"
check "chained restore rows" "SELECT count() FROM e2e.events" "6"
check "chained restore checksum" "SELECT sum(value) FROM e2e.events" "2100"

echo ""
echo "=== Phase 4: Verify CONFIRM_RESTORE guard ==="

# Drop the target table so a real restore would succeed if the guard were broken.
# Without this, the test could pass for the wrong reason (restore failing because
# the table already exists, not because the guard blocked it).
query "DROP TABLE IF EXISTS e2e.events SYNC"

# restore-data.sh should refuse without CONFIRM_RESTORE=yes
if docker exec \
    -e CLICKHOUSE_HOST=localhost \
    -e CLICKHOUSE_PASSWORD=test123 \
    -e BACKUP_DATABASE=e2e \
    -e BACKUP_NAME="$FULL_BACKUP_NAME" \
    -e CONFIRM_RESTORE=no \
    "$CH" /scripts/restore-data.sh 2>/dev/null; then
    echo "  FAIL: restore-data.sh should have rejected CONFIRM_RESTORE=no"
    fail=$((fail + 1))
else
    echo "  PASS: restore-data.sh correctly rejected CONFIRM_RESTORE=no"
    pass=$((pass + 1))
fi

echo ""
echo "=== Phase 5: The sidecar survives a restart mid-backup, then chains and restores ==="

SERVER_STARTED=$(query "SELECT toUnixTimestamp(now()) - uptime()" | tr -d '[:space:]')
query "CREATE DATABASE IF NOT EXISTS e2e_side"
query "CREATE TABLE e2e_side.blob (n UInt64, payload String) ENGINE = MergeTree ORDER BY n"
# ~40 MB of incompressible data at 2 MiB/s keeps the full in flight for ~20s.
query "INSERT INTO e2e_side.blob SELECT number, randomString(1000) FROM numbers(40000)"
docker exec "$CH" sh -c 'printf test123 > /tmp/backup-password'

start_sidecar() {
    docker exec -d \
        -e BACKUP_SIDECAR=run \
        -e BACKUP_USER=default \
        -e BACKUP_PASSWORD_FILE=/tmp/backup-password \
        -e BACKUP_DATABASE=e2e_side \
        -e BACKUP_FULL_SCHEDULE='0 0 1 1 *' \
        -e BACKUP_INCREMENTAL_SCHEDULE='* * * * *' \
        -e BACKUP_MAX_BANDWIDTH=2097152 \
        -e BACKUP_METRICS_LISTEN=127.0.0.1:8125 \
        "$CH" sh -c 'echo $$ > /tmp/sidecar.pid; exec ch-config sidecar /etc/clickhouse-server'
}
stop_sidecar() { docker exec "$CH" sh -c 'kill "$(cat /tmp/sidecar.pid)"' || true; }
wait_for() { # <description> <query> <expected> <seconds>
    local i
    for i in $(seq 1 "$4"); do
        [ "$(query "$2" | tr -d '[:space:]')" = "$3" ] && return 0
        sleep 1
    done
    echo "  FAIL: timed out waiting for $1"
    fail=$((fail + 1))
}

# No full has ever been taken of e2e_side, so the yearly full is owed at once.
start_sidecar
wait_for "the sidecar to start a full" \
    "SELECT count() FROM system.backups WHERE id LIKE 'e2e_side_full_%' AND status = 'CREATING_BACKUP'" "1" 30
stop_sidecar
sleep 3
check "the full carries on with the sidecar gone" \
    "SELECT status FROM system.backups WHERE id LIKE 'e2e_side_full_%'" "CREATING_BACKUP"

start_sidecar
wait_for "the adopted full to complete" \
    "SELECT status FROM system.backups WHERE id LIKE 'e2e_side_full_%' ORDER BY start_time DESC LIMIT 1" "BACKUP_CREATED" 180
check "the restarted sidecar adopted the full, not started a second" \
    "SELECT count() FROM system.backups WHERE id LIKE 'e2e_side_full_%'" "1"
sleep 2
METRICS=$(docker exec "$CH" curl -sf http://127.0.0.1:8125/metrics || true)
for want in 'clickhouse_backup_runner 1' 'clickhouse_backup_last_success_timestamp_seconds{mode="full"}' 'clickhouse_backup_failures_total{mode="full"} 0'; do
    if grep -qF "$want" <<<"$METRICS"; then
        echo "  PASS: metrics carry $want"; pass=$((pass + 1))
    else
        echo "  FAIL: metrics lack $want"; fail=$((fail + 1))
    fi
done
if docker exec "$CH" curl -sf http://127.0.0.1:8125/status | grep -q '"last_outcome": "succeeded"'; then
    echo "  PASS: status reports the adopted full"; pass=$((pass + 1))
else
    echo "  FAIL: status does not report the adopted full"; fail=$((fail + 1))
fi

query "INSERT INTO e2e_side.blob SELECT number + 40000, randomString(10) FROM numbers(100)"
# The minute tick may already have chained an incremental on the full, before
# this insert. Only one that started in a later second can hold these rows.
INSERTED_AT=$(query "SELECT toUnixTimestamp(now())" | tr -d '[:space:]')
AFTER_INSERT="id LIKE 'e2e_side_incremental_%' AND status = 'BACKUP_CREATED' AND toUnixTimestamp(start_time) > ${INSERTED_AT}"
wait_for "an incremental chained after the insert" \
    "SELECT count() > 0 FROM system.backups WHERE ${AFTER_INSERT}" "1" 150
stop_sidecar
SIDE_INC=$(query "SELECT id FROM system.backups WHERE ${AFTER_INSERT} ORDER BY start_time DESC LIMIT 1" | tr -d '[:space:]')
query "DROP TABLE e2e_side.blob SYNC"
docker exec \
    -e CLICKHOUSE_USER=default \
    -e CLICKHOUSE_PASSWORD=test123 \
    -e BACKUP_DATABASE=e2e_side \
    "$CH" ch-config backup restore --name "$SIDE_INC" --confirm
check "sidecar chain restore rows" "SELECT count() FROM e2e_side.blob" "40100"
# Same start time, to the second: uptime alone is under a minute on a fast run.
check "the server never restarted" \
    "SELECT abs(toUnixTimestamp(now()) - uptime() - ${SERVER_STARTED}) <= 1" "1"

echo ""
echo "=== Results: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
    echo "E2E (backup) FAILED"
    docker logs "$CH" 2>&1 | tail -30
    exit 1
fi
echo "E2E (backup) PASSED"
