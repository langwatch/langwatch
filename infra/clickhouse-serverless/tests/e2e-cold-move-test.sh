#!/usr/bin/env bash
# E2E test: verify data moves from hot to cold (S3) storage via TTL rules.
# Uses RustFS as S3-compatible storage (MinIO-compatible fork, actively maintained).
# Usage: ./tests/e2e-cold-move-test.sh [image:tag]
set -euo pipefail

IMAGE="${1:-clickhouse-serverless:test}"
NET="ch-cold-move-net"
CH="ch-cold-move"
S3="rustfs-cold-move"
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

echo "=== Cold storage data movement E2E test ==="
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

# Create bucket via AWS CLI (RustFS is S3-compatible)
docker run --rm --network "$NET" \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
    -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    amazon/aws-cli:2.27.31 \
    --endpoint-url "http://$S3:9000" s3 mb "s3://$BUCKET"
echo "RustFS ready"

S3_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$S3")

# --- Start ClickHouse with cold storage ---
docker run -d --name "$CH" --network "$NET" \
    -p 18123:8123 \
    -e CH_CPU=2 \
    -e CH_RAM=2147483648 \
    -e CLICKHOUSE_PASSWORD=test123 \
    -e COLD_STORAGE_ENABLED=true \
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

query() {
    local result
    result=$(curl -sf --connect-timeout 5 --max-time 30 "http://localhost:18123/?password=test123" --data "$1")
    if echo "$result" | grep -q "Code:"; then
        echo "QUERY ERROR: $result" >&2
        return 1
    fi
    echo "$result"
}

echo ""
echo "=== Testing cold storage data movement ==="

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

# Create table with TTL that moves data to cold volume after 1 second
query "CREATE TABLE default.cold_test (
    ts DateTime,
    msg String
) ENGINE = MergeTree()
ORDER BY ts
TTL ts + INTERVAL 1 SECOND TO VOLUME 'cold'
SETTINGS storage_policy = 'local_primary'"

# Insert data with old timestamps (well past TTL)
query "INSERT INTO default.cold_test VALUES
    ('2020-01-01 00:00:00', 'old data 1'),
    ('2020-01-01 00:00:01', 'old data 2'),
    ('2020-01-01 00:00:02', 'old data 3')"

# Force merge to trigger TTL evaluation
query "OPTIMIZE TABLE default.cold_test FINAL"

# Wait for merge to complete
sleep 3

# Verify all active parts moved to cold storage (object disk)
check "all parts on cold disk" \
    "SELECT if(countIf(disk_name != 'object') = 0, 'object', 'mixed') FROM system.parts WHERE table='cold_test' AND active" \
    "object"

# Data should still be readable
check "row count" \
    "SELECT count() FROM default.cold_test" \
    "3"

# Verify the storage policy exists
check "storage_policy" \
    "SELECT DISTINCT policy_name FROM system.storage_policies WHERE policy_name='local_primary'" \
    "local_primary"

echo ""
echo "=== Results: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
    echo "E2E (cold-move) FAILED"
    docker logs "$CH" 2>&1 | tail -30
    exit 1
fi
echo "E2E (cold-move) PASSED"
