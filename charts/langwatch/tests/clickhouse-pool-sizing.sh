#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

render_component() {
  local component="$1"
  shift
  helm template lw . \
    --set autogen.enabled=true \
    --set app.dataplane.enabled=true \
    --set langyagent.chartManaged=false \
    "$@" | awk \
    -v source="langwatch/templates/${component}/deployment.yaml" '
      $0 == "# Source: " source { printing=1; next }
      printing && /^# Source:/ { printing=0 }
      printing { print }
    '
}

env_value() {
  local block="$1" name="$2"
  printf '%s' "$block" | awk -v name="$name" '
    $0 ~ "name: " name "$" { found=1; next }
    found && /value:/ { gsub(/"/, "", $2); print $2; exit }
  '
}

expect_env() {
  local label="$1" block="$2" name="$3" want="$4" got
  got=$(env_value "$block" "$name")
  if [ "$got" = "$want" ]; then
    echo "ok   [$label] $name=$got"
    return
  fi

  echo "FAIL [$label] $name=${got:-<absent>}, expected $want"
  failures=$((failures + 1))
}

default_app=$(render_component app)
default_worker=$(render_component workers)
expect_env "default app fleet" "$default_app" CLICKHOUSE_CLIENT_REPLICAS 2
expect_env "default worker fleet" "$default_worker" CLICKHOUSE_CLIENT_REPLICAS 2
expect_env "default nodes" "$default_app" CLICKHOUSE_SERVER_NODES 1
expect_env "default budget" "$default_app" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 300

managed=$(render_component app \
  --set app.replicaCount=3 \
  --set workers.replicaCount=4 \
  --set clickhouse.replicas=3 \
  --set clickhouse.env.MAX_CONCURRENT_QUERIES=240 \
  --set clickhouse.client.maxOpenConnections=12)
expect_env "managed fleet" "$managed" CLICKHOUSE_CLIENT_REPLICAS 7
expect_env "managed nodes" "$managed" CLICKHOUSE_SERVER_NODES 3
expect_env "managed budget" "$managed" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 240
expect_env "managed override" "$managed" CLICKHOUSE_MAX_OPEN_CONNECTIONS 12

external=$(render_component app \
  --set app.replicaCount=2 \
  --set workers.enabled=false \
  --set clickhouse.chartManaged=false \
  --set-string clickhouse.external.url.value=http://clickhouse:8123/langwatch \
  --set clickhouse.external.serverNodes=5 \
  --set clickhouse.external.serverMaxConcurrentQueries=700)
expect_env "external fleet" "$external" CLICKHOUSE_CLIENT_REPLICAS 2
expect_env "external nodes" "$external" CLICKHOUSE_SERVER_NODES 5
expect_env "external budget" "$external" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 700

if [ "$failures" -ne 0 ]; then
  exit 1
fi
