#!/usr/bin/env bash
# Starts a ClickHouse container with a custom storage policy loaded at startup.
# The storage policy (local_primary) uses hot+cold local disks, which must be
# configured before the server starts — SYSTEM RELOAD CONFIG cannot add policies.
set -euo pipefail

CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-ci_password}"

# ---------------------------------------------------------------------------
# Step 1: Write storage policy config
# ---------------------------------------------------------------------------
# Note: Storage policies can only be loaded at server startup, not via SYSTEM RELOAD CONFIG
# Each disk must have a unique name AND path - we define 'hot' and 'cold' disks with different paths
cat > /tmp/storage_policy.xml << 'EOF'
<clickhouse>
    <storage_configuration>
        <disks>
            <hot>
                <path>/var/lib/clickhouse/hot/</path>
            </hot>
            <cold>
                <path>/var/lib/clickhouse/cold/</path>
            </cold>
        </disks>
        <policies>
            <local_primary>
                <volumes>
                    <hot>
                        <disk>hot</disk>
                    </hot>
                    <cold>
                        <disk>cold</disk>
                    </cold>
                </volumes>
            </local_primary>
        </policies>
    </storage_configuration>
</clickhouse>
EOF

# ---------------------------------------------------------------------------
# Step 2: Start ClickHouse container with config mounted (loads at startup)
# ---------------------------------------------------------------------------
docker run -d \
  --name clickhouse \
  --network host \
  -e CLICKHOUSE_DB=default \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD}" \
  -v /tmp/storage_policy.xml:/etc/clickhouse-server/config.d/storage_policy.xml:ro \
  clickhouse/clickhouse-server:latest

# ---------------------------------------------------------------------------
# Step 3: Readiness loop — wait for ClickHouse HTTP interface to respond
# ---------------------------------------------------------------------------
echo "Waiting for ClickHouse to be ready..."
READY=0
for i in $(seq 1 60); do
  if curl -sf "http://localhost:8123/?user=default&password=${CLICKHOUSE_PASSWORD}" -d "SELECT 1" >/dev/null 2>&1; then
    echo "ClickHouse is ready"
    READY=1
    break
  fi
  echo "Attempt $i: Waiting for ClickHouse..."
  sleep 1
done

if [ "$READY" -eq 0 ]; then
  echo "ClickHouse failed to become ready — container logs:" >&2
  docker logs clickhouse >&2 || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Verify storage policy is available (retry loop — policy may take a
# moment to appear even after the server reports ready)
# ---------------------------------------------------------------------------
echo "Verifying storage policy..."
VERIFIED=0
for i in $(seq 1 30); do
  RESPONSE="$(curl -sf "http://localhost:8123/?user=default&password=${CLICKHOUSE_PASSWORD}" \
    -d "SELECT policy_name, volume_name, disks FROM system.storage_policies WHERE policy_name = 'local_primary'" \
    2>/dev/null || true)"
  if printf '%s' "$RESPONSE" | grep -qF "local_primary"; then
    echo "Storage policy 'local_primary' verified"
    VERIFIED=1
    break
  fi
  echo "Attempt $i: verifying storage policy..."
  sleep 1
done

if [ "$VERIFIED" -eq 0 ]; then
  echo "Storage policy 'local_primary' failed to become available — container logs:" >&2
  docker logs clickhouse >&2 || true
  exit 1
fi

echo "ClickHouse started successfully with storage policy 'local_primary'"
