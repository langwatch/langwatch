#!/usr/bin/env bash
#
# Renders the chart and asserts the ClickHouse pool-sizing inputs that actually
# reach the app and worker pods.
#
# This executes the template pipeline rather than reading it. The client divides
# the platform's concurrent-query share by the fleet, and there are two ways to
# get that wrong that both render as valid YAML on a healthy pod:
#
#   - CLICKHOUSE_CLIENT_REPLICAS absent, which is what a missing include looks
#     like. The derivation is skipped and the client keeps a fixed 64 per pool,
#     the sizing that had ClickHouse reject tens of thousands of queries with
#     TOO_MANY_SIMULTANEOUS_QUERIES on 2026-07-31.
#   - CLICKHOUSE_CLIENT_REPLICAS counting one Deployment instead of the fleet.
#     Each Deployment then divides the whole share, and their pools sum past it.
#
# Only a render shows which number reached which pod, so the assertions below
# are on both Deployments at once rather than on either alone.
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

# @scenario "Every pod that builds a ClickHouse client counts the whole fleet"
test_both_deployments_count_the_whole_fleet() {
  # One app pod plus one worker pod.
  expect_env "app default" app "$BASE_FLAGS" CLICKHOUSE_CLIENT_REPLICAS 2
  expect_env "workers default" workers "$BASE_FLAGS" CLICKHOUSE_CLIENT_REPLICAS 2

  # Three app pods plus ten worker pods. Both halves must say 13: the failure
  # this guards is each Deployment reporting its own 3 and 10, which has them
  # dividing the same share twice over.
  local scaled="$BASE_FLAGS $MULTI_REPLICA_FLAGS --set app.replicaCount=3 --set workers.replicaCount=10"
  expect_env "app scaled" app "$scaled" CLICKHOUSE_CLIENT_REPLICAS 13
  expect_env "workers scaled" workers "$scaled" CLICKHOUSE_CLIENT_REPLICAS 13
}

# @scenario "Scaling one deployment resizes the pools of both"
test_scaling_one_deployment_resizes_both() {
  local app_only="$BASE_FLAGS $MULTI_REPLICA_FLAGS --set app.replicaCount=4"
  expect_env "app scaled alone" app "$app_only" CLICKHOUSE_CLIENT_REPLICAS 5
  expect_env "workers see app scaling" workers "$app_only" CLICKHOUSE_CLIENT_REPLICAS 5
}

# @scenario "A deployment that renders no pods is not counted"
test_disabled_workers_are_not_counted() {
  # workers.replicaCount is left at its default on purpose: a disabled
  # Deployment renders no pods, so counting its replicas would shrink every
  # app pool to pay for connections nobody opens.
  local no_workers="--set autogen.enabled=true --set workers.enabled=false --set app.replicaCount=1"
  expect_env "app without workers" app "$no_workers" CLICKHOUSE_CLIENT_REPLICAS 1
}

# @scenario "The platform's share defaults to less than the whole server"
test_share_defaults_below_the_server_limit() {
  expect_env "app default share" app "$BASE_FLAGS" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 270
  expect_env "workers default share" workers "$BASE_FLAGS" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 270
}

# @scenario "An operator granted a different share states it once"
test_operator_states_the_share_once() {
  local tuned="$BASE_FLAGS --set clickhouse.platformConcurrentQueryShare=500"
  expect_env "app tuned share" app "$tuned" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 500
  expect_env "workers tuned share" workers "$tuned" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 500
}

test_both_deployments_count_the_whole_fleet
test_scaling_one_deployment_resizes_both
test_disabled_workers_are_not_counted
test_share_defaults_below_the_server_limit
test_operator_states_the_share_once

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures ClickHouse pool-sizing check(s) failed"
  exit 1
fi

echo
echo "all ClickHouse pool-sizing checks pass"
