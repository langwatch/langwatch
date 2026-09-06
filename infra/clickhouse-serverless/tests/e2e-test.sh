#!/usr/bin/env bash
# E2E test: starts ClickHouse, verifies computed settings via SQL.
# Usage: ./tests/e2e-test.sh [image:tag]
set -euo pipefail

IMAGE="${1:-clickhouse-serverless:test}"
NET="ch-test-net"
CH="ch-e2e"

cleanup() {
    echo "--- cleanup ---"
    docker rm -f "$CH" 2>/dev/null || true
    docker network rm "$NET" 2>/dev/null || true
}
trap cleanup EXIT

cleanup  # clean any leftover from previous run

echo "=== Starting ClickHouse E2E test ==="
docker network create "$NET" 2>/dev/null || true

# Start ClickHouse (no cold storage — core config test)
# Use 2GB RAM / 2 CPU — fits within Docker Desktop and CI runners
docker run -d --name "$CH" --network "$NET" \
    -p 18123:8123 \
    -e CH_CPU=2 \
    -e CH_RAM=2147483648 \
    -e CLICKHOUSE_PASSWORD=test123 \
    -e ENABLE_QUERY_LOG=true \
    -e ENABLE_PART_LOG=true \
    "$IMAGE"

# Wait for readiness
echo "Waiting for ClickHouse..."
ready=0
for i in $(seq 1 60); do
    if curl -sf --connect-timeout 2 --max-time 5 'http://localhost:18123/ping' >/dev/null 2>&1; then
        echo "ClickHouse ready (${i}s)"
        ready=1
        break
    fi
    sleep 1
done
if [ "$ready" -ne 1 ]; then
    echo "FAIL: ClickHouse did not start"
    docker logs "$CH" 2>&1 | tail -50
    exit 1
fi

# SQL query helper
query() { curl -sf --connect-timeout 5 --max-time 30 "http://localhost:18123/?password=test123" --data "$1"; }

pass=0
fail=0
check() {
    local name="$1" query="$2" expect="$3"
    result=$(query "$query" | tr -d '[:space:]')
    if [ "$result" = "$expect" ]; then
        echo "  PASS: $name = $result"
        pass=$((pass + 1))
    else
        echo "  FAIL: $name = $result (expected $expect)"
        fail=$((fail + 1))
    fi
}

check_range() {
    local name="$1" query="$2" min="$3" max="$4"
    result=$(query "$query" | tr -d '[:space:]')
    if [ "$result" -gt "$min" ] 2>/dev/null && [ "$result" -lt "$max" ] 2>/dev/null; then
        echo "  PASS: $name = $result (in range $min-$max)"
        pass=$((pass + 1))
    else
        echo "  FAIL: $name = $result (expected range $min-$max)"
        fail=$((fail + 1))
    fi
}

echo ""
echo "=== Verifying computed settings ==="

# Memory: 85% of 2GB ≈ 1,825,361,100
check_range "max_server_memory_usage" \
    "SELECT value FROM system.server_settings WHERE name='max_server_memory_usage'" \
    1700000000 1900000000

# MergeTree: 2 CPU → max_parts_to_merge_at_once = 5
check "max_parts_to_merge_at_once" \
    "SELECT value FROM system.merge_tree_settings WHERE name='max_parts_to_merge_at_once'" \
    "5"

# Background pool: max(2, 2/2) = 2
check "background_pool_size" \
    "SELECT value FROM system.server_settings WHERE name='background_pool_size'" \
    "2"

# Async inserts enabled
check "async_insert" \
    "SELECT value FROM system.settings WHERE name='async_insert'" \
    "1"

# Network
check "max_connections" \
    "SELECT value FROM system.server_settings WHERE name='max_connections'" \
    "4096"

# Concurrent queries: min(2*25, 200) = 50
check "max_concurrent_queries" \
    "SELECT value FROM system.server_settings WHERE name='max_concurrent_queries'" \
    "50"

echo ""
echo "=== Results: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
    echo "E2E FAILED"
    docker logs "$CH" 2>&1 | tail -30
    exit 1
fi
echo "E2E PASSED"
