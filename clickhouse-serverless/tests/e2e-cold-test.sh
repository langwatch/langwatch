#!/usr/bin/env bash
# E2E test with cold storage: Garage (S3-compatible) + ClickHouse.
# Usage: ./tests/e2e-cold-test.sh [image:tag]
set -euo pipefail

IMAGE="${1:-clickhouse-serverless:test}"
NET="ch-test-net"
CH="ch-e2e"
GARAGE="garage-e2e"

cleanup() {
    echo "--- cleanup ---"
    docker rm -f "$CH" "$GARAGE" 2>/dev/null || true
    docker network rm "$NET" 2>/dev/null || true
    rm -rf /tmp/garage-e2e 2>/dev/null || true
}
trap cleanup EXIT
cleanup

echo "=== Starting cold-storage E2E test ==="
docker network create "$NET" 2>/dev/null || true

# --- Start Garage ---
mkdir -p /tmp/garage-e2e/{data,meta}
RPC_SECRET=$(openssl rand -hex 32)
cat > /tmp/garage-e2e/garage.toml << EOF
metadata_dir = "/tmp/garage/meta"
data_dir = "/tmp/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_secret = "${RPC_SECRET}"

[s3_api]
s3_region = "us-east-1"
api_bind_addr = "0.0.0.0:3900"
root_domain = ".s3.garage.localhost"

[s3_web]
bind_addr = "0.0.0.0:3902"
root_domain = ".web.garage.localhost"

[admin]
api_bind_addr = "0.0.0.0:3903"
EOF

docker run -d --name "$GARAGE" --network "$NET" \
    -p 3900:3900 -p 3903:3903 \
    -v /tmp/garage-e2e/garage.toml:/etc/garage.toml \
    -v /tmp/garage-e2e/data:/tmp/garage/data \
    -v /tmp/garage-e2e/meta:/tmp/garage/meta \
    dxflrs/garage:v1.1.0 \
    /garage -c /etc/garage.toml server

echo "Waiting for Garage..."
garage_ready=0
for i in $(seq 1 30); do
    if curl -sf --connect-timeout 3 --max-time 5 http://localhost:3903/health >/dev/null 2>&1; then
        garage_ready=1
        break
    fi
    sleep 1
done
if [ "$garage_ready" -ne 1 ]; then
    echo "FAIL: Garage did not become healthy at http://localhost:3903/health"
    docker logs "$GARAGE" 2>&1 | tail -30
    exit 1
fi

# Configure Garage cluster
NODE_ID=$(docker exec "$GARAGE" /garage -c /etc/garage.toml node id -q | cut -c1-16)
docker exec "$GARAGE" /garage -c /etc/garage.toml layout assign -z dc1 -c 1G "$NODE_ID"
docker exec "$GARAGE" /garage -c /etc/garage.toml layout apply --version 1

# Create key + bucket
docker exec "$GARAGE" /garage -c /etc/garage.toml key create clickhouse-key
KEY_INFO=$(docker exec "$GARAGE" /garage -c /etc/garage.toml key info clickhouse-key)
ACCESS_KEY=$(echo "$KEY_INFO" | grep "Key ID" | awk '{print $NF}')
SECRET_KEY=$(echo "$KEY_INFO" | grep "Secret key" | awk '{print $NF}')

docker exec "$GARAGE" /garage -c /etc/garage.toml bucket create clickhouse
docker exec "$GARAGE" /garage -c /etc/garage.toml bucket allow --read --write --owner clickhouse --key clickhouse-key
echo "Garage ready"

# --- Start ClickHouse with cold storage ---
GARAGE_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$GARAGE")

docker run -d --name "$CH" --network "$NET" \
    -p 18123:8123 \
    -e CH_CPU=2 \
    -e CH_RAM=2147483648 \
    -e CLICKHOUSE_PASSWORD=test123 \
    -e COLD_STORAGE_ENABLED=true \
    -e STORAGE_TYPE=s3 \
    -e "S3_ENDPOINT=http://${GARAGE_IP}:3900/clickhouse/" \
    -e "S3_ACCESS_KEY=${ACCESS_KEY}" \
    -e "S3_SECRET_KEY=${SECRET_KEY}" \
    -e S3_REGION=us-east-1 \
    -e USE_ENVIRONMENT_CREDENTIALS=false \
    -e ENABLE_QUERY_LOG=true \
    -e ENABLE_PART_LOG=true \
    "$IMAGE"

# Wait for readiness
echo "Waiting for ClickHouse..."
ready=0
for i in $(seq 1 60); do
    if curl -sf --connect-timeout 3 --max-time 5 'http://localhost:18123/ping' >/dev/null 2>&1; then
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

# --- Verify ---
query() { curl -sf --connect-timeout 5 --max-time 30 "http://localhost:18123/?password=test123" --data "$1"; }

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

echo ""
echo "=== Verifying settings ==="

check "storage_policy" \
    "SELECT DISTINCT policy_name FROM system.storage_policies WHERE policy_name='local_primary'" \
    "local_primary"

check "background_pool_size" \
    "SELECT value FROM system.server_settings WHERE name='background_pool_size'" \
    "2"

check "async_insert" \
    "SELECT value FROM system.settings WHERE name='async_insert'" \
    "1"

echo ""
echo "=== Results: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
    echo "E2E (cold) FAILED"
    docker logs "$CH" 2>&1 | tail -30
    exit 1
fi
echo "E2E (cold) PASSED"
