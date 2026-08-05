#!/usr/bin/env bash
#
# Renders the chart and asserts the ClickHouse pool-sizing inputs that actually
# reach the app and worker pods.
#
# This executes the template pipeline rather than reading it. The client derives
# its pool size from the server's concurrent-query budget divided across the
# fleet, and the derivation is skipped entirely when CLICKHOUSE_CLIENT_REPLICAS
# is absent - the client then keeps a fixed 64 connections per pool, which is
# the sizing that had ClickHouse reject tens of thousands of queries with
# TOO_MANY_SIMULTANEOUS_QUERIES on 2026-07-31. An absent variable is exactly
# what a missing include renders, and it renders green: valid YAML, a healthy
# pod, and the pre-incident behaviour. Only a render shows whether the number
# is there at all.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies - the next
# line that is neither blank nor a comment must be that function.
#
# See specs/setup/helm-clickhouse-pool-sizing.feature.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/clickhouse-pool-sizing.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# The stock rendering needs generated secrets; more than one replica of either
# Deployment needs the shared object store, because the local-filesystem
# backend is a single-node topology the chart refuses to render past one pod.
readonly BASE_FLAGS="--set autogen.enabled=true --set workers.enabled=true"
readonly MULTI_REPLICA_FLAGS="--set app.storedObjects.localFilesystem.enabled=false --set app.dataplane.enabled=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Renders one component's Deployment only, so a value emitted on another pod
# can never satisfy an assertion.
render_component() {
  local component="$1" flags="$2"
  # shellcheck disable=SC2086
  helm template lw . $flags | awk -v want="langwatch/templates/$component/deployment.yaml" '
    $0 == "# Source: " want { grab=1 }
    grab && /^# Source:/ && $0 != "# Source: " want { grab=0 }
    grab { print }
  '
}

# No early `exit` in awk: it would close the pipe under `set -o pipefail` and
# the producer would die on SIGPIPE. Take the first match at the end instead.
env_value_of() {
  printf '%s' "$1" | awk -v name="$2" '
    $0 ~ ("name: " name "$") { want=1; next }
    want && /value:/ { gsub(/"/,"",$2); print $2; want=0 }
  ' | head -n 1
}

# Asserts one environment variable on one component's pod.
expect_env() {
  local label="$1" component="$2" flags="$3" name="$4" want="$5" block got
  block=$(render_component "$component" "$flags")
  if [ -z "$block" ]; then
    fail "$label" "rendered no $component Deployment"
    return
  fi
  got=$(env_value_of "$block" "$name")
  if [ "$got" != "$want" ]; then
    fail "$label" "$name is '${got:-<absent>}', expected '$want'"
    return
  fi
  echo "ok   [$label] $component $name=$got"
}

# @scenario "Every pod that builds a ClickHouse client is told its own replica count"
test_both_deployments_receive_their_replica_count() {
  expect_env "app default" app "$BASE_FLAGS" CLICKHOUSE_CLIENT_REPLICAS 1
  expect_env "workers default" workers "$BASE_FLAGS" CLICKHOUSE_CLIENT_REPLICAS 1

  local scaled="$BASE_FLAGS $MULTI_REPLICA_FLAGS --set app.replicaCount=3 --set workers.replicaCount=10"
  expect_env "app scaled" app "$scaled" CLICKHOUSE_CLIENT_REPLICAS 3
  expect_env "workers scaled" workers "$scaled" CLICKHOUSE_CLIENT_REPLICAS 10
}

# @scenario "Scaling one deployment leaves the other's sizing alone"
test_scaling_one_deployment_leaves_the_other_alone() {
  local app_only="$BASE_FLAGS $MULTI_REPLICA_FLAGS --set app.replicaCount=4"
  expect_env "app scaled alone" app "$app_only" CLICKHOUSE_CLIENT_REPLICAS 4
  expect_env "workers unscaled" workers "$app_only" CLICKHOUSE_CLIENT_REPLICAS 1
}

# @scenario "The server's budget defaults to the ClickHouse default"
test_server_budget_defaults_to_the_clickhouse_default() {
  expect_env "app default budget" app "$BASE_FLAGS" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 300
  expect_env "workers default budget" workers "$BASE_FLAGS" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 300
}

# @scenario "An operator with a tuned server states the budget once"
test_operator_states_the_budget_once() {
  local tuned="$BASE_FLAGS --set clickhouse.serverMaxConcurrentQueries=500"
  expect_env "app tuned budget" app "$tuned" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 500
  expect_env "workers tuned budget" workers "$tuned" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 500
}

test_both_deployments_receive_their_replica_count
test_scaling_one_deployment_leaves_the_other_alone
test_server_budget_defaults_to_the_clickhouse_default
test_operator_states_the_budget_once

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures ClickHouse pool-sizing check(s) failed"
  exit 1
fi

echo
echo "all ClickHouse pool-sizing checks pass"
