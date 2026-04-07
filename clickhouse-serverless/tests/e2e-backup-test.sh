#!/usr/bin/env bash
# E2E test: exercises the shipped /scripts/backup-data.sh and /scripts/restore-data.sh
# via docker exec, exactly as the Helm CronJobs would run them.
# Uses RustFS as S3-compatible storage.
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
    if curl -so /dev/null http://localhost:9000/ 2>/dev/null; then
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
    if curl -sf 'http://localhost:18123/ping' >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then
    echo "FAIL: ClickHouse not ready"; docker logs "$CH" 2>&1 | tail -50; exit 1
fi

# Helper: run SQL via HTTP (for data setup/verification only — not for backup/restore)
query() {
    local result
    result=$(curl -sf "http://localhost:18123/?password=test123" --data "$1")
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
echo "=== Phase 1: Create data and full backup ==="

query "CREATE DATABASE IF NOT EXISTS e2e"
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
echo "=== Results: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
    echo "E2E (backup) FAILED"
    docker logs "$CH" 2>&1 | tail -30
    exit 1
fi
echo "E2E (backup) PASSED"
