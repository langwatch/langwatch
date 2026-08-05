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

# The EFFECTIVE value, which is the LAST one rendered - Kubernetes applies
# duplicate env entries in order, so a later entry silently wins. Reading the
# first would report the chart's value while the container ran someone else's:
# an `extraEnvs` addition landing after this block is exactly where a second
# entry appears, and it is invisible to a first-match read.
#
# No early `exit` in awk: it would close the pipe under `set -o pipefail` and
# the producer would die on SIGPIPE. Take the last match at the end instead.
env_value_of() {
  printf '%s' "$1" | awk -v name="$2" '
    $0 ~ ("name: " name "$") { want=1; next }
    want && /value:/ { gsub(/"/,"",$2); print $2; want=0 }
  ' | tail -n 1
}

env_occurrences_of() {
  printf '%s' "$1" | grep -c "name: $2\$" || true
}

# Asserts one environment variable on one component's pod: the effective value,
# and that nothing else in the pod also sets it.
#
# The count is the assertion that actually closes the duplicate hole. Reading
# the last entry makes the suite agree with the container, but a duplicate is a
# defect in its own right whichever value wins - two answers to "how big is the
# fleet" means one of them is wrong. It is counted across the whole Deployment
# rather than per container because every container in these pods runs the same
# app image against the same ClickHouse, so a second answer anywhere in the pod
# is a second answer.
expect_env() {
  local label="$1" component="$2" flags="$3" name="$4" want="$5" block got count
  block=$(render_component "$component" "$flags")
  if [ -z "$block" ]; then
    fail "$label" "rendered no $component Deployment"
    return
  fi
  count=$(env_occurrences_of "$block" "$name")
  if [ "$count" != "1" ]; then
    fail "$label" "$name appears $count times in the $component pod, expected exactly 1"
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
test_deployments_with_no_pods_are_not_counted() {
  # workers.replicaCount is left at its default on purpose: a disabled
  # Deployment renders no pods, so counting its replicas would shrink every
  # app pool to pay for connections nobody opens.
  local no_workers="--set autogen.enabled=true --set workers.enabled=false --set app.replicaCount=1"
  expect_env "app without workers" app "$no_workers" CLICKHOUSE_CLIENT_REPLICAS 1

  # Scaled to zero is the same thing by a different route, and it is the one a
  # `default 1` in the helper would silently get wrong, because Helm's `default`
  # treats 0 as empty.
  local zero_workers="$BASE_FLAGS --set workers.replicaCount=0"
  expect_env "app with zero workers" app "$zero_workers" CLICKHOUSE_CLIENT_REPLICAS 1
}

# @scenario "The budget defaults to what this chart's own ClickHouse admits"
test_budget_defaults_to_the_chart_managed_limit() {
  # The subchart's image computes max_concurrent_queries as min(cpu x 25, 200),
  # and clickhouse.cpu defaults to 2. Asserting 50 rather than a round number
  # is the point: a default install must not be told about a budget belonging
  # to some other deployment's server.
  expect_env "app default budget" app "$BASE_FLAGS" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 50
  expect_env "workers default budget" workers "$BASE_FLAGS" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 50

  # Follows the CPU it is given, and rounds a fractional core up the way the
  # image's own ParseCPU does.
  local cpu8="$BASE_FLAGS --set clickhouse.cpu=8"
  expect_env "app at cpu 8" app "$cpu8" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 200
  local cpu1500m="$BASE_FLAGS --set clickhouse.cpu=1500m"
  expect_env "app at cpu 1500m" app "$cpu1500m" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 50

  # And is capped: no CPU size reaches past 200.
  local cpu64="$BASE_FLAGS --set clickhouse.cpu=64"
  expect_env "app at cpu 64" app "$cpu64" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 200
}

# @scenario "An external server falls back to the ClickHouse default"
test_external_server_uses_the_clickhouse_default() {
  local external="--set autogen.enabled=true --set workers.enabled=true --set clickhouse.chartManaged=false --set clickhouse.external.url.value=http://ch:8123/langwatch"
  expect_env "app external" app "$external" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 300
  expect_env "workers external" workers "$external" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 300
}

# @scenario "An operator granted a different budget states it once"
test_operator_states_the_budget_once() {
  # Under the chart-managed cap, so it is honoured. 270 is the LangWatch Cloud
  # figure and belongs to an external server, which is why it is not a default.
  local tuned="$BASE_FLAGS --set clickhouse.cpu=16 --set clickhouse.platformConcurrentQueryShare=150"
  expect_env "app tuned budget" app "$tuned" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 150
  expect_env "workers tuned budget" workers "$tuned" CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES 150
}

# @scenario "A budget larger than the chart's own server is refused"
test_budget_above_the_chart_managed_limit_is_refused() {
  # 270 against a default chart-managed server, which admits 50. Rendering has
  # to STOP: the alternative is pods sizing for a budget the server never had,
  # which is only discovered as rejected queries in production.
  local output
  if output=$(helm template lw . --set autogen.enabled=true --set workers.enabled=true --set clickhouse.platformConcurrentQueryShare=270 2>&1); then
    fail "over-budget share" "render succeeded; expected it to fail"
    return
  fi
  if ! printf '%s' "$output" | grep -q "admits at most 50 concurrent queries"; then
    fail "over-budget share" "render failed without naming the limit: $(printf '%s' "$output" | tail -n 2)"
    return
  fi
  echo "ok   [over-budget share] render refused and named the server's limit"
}

# @scenario "The chart emits the names the client actually reads"
test_emitted_names_match_the_package_contract() {
  # The chart sets these; @langwatch/clickhouse-client reads them. Nothing in
  # CI runs that package's own tests, so a rename on its side would leave every
  # check green and the derivation inert - the exact failure this whole suite
  # exists to prevent, one repository directory away. A literal string is the
  # contract here, so a literal check is the right instrument.
  local pool_src="../../packages/clickhouse-client/src/pool.ts" name
  if [ ! -f "$pool_src" ]; then
    fail "package contract" "cannot find $pool_src"
    return
  fi
  for name in CLICKHOUSE_CLIENT_REPLICAS CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES; do
    if ! grep -q "\"$name\"" "$pool_src"; then
      fail "package contract" "the chart emits $name but pool.ts does not read it"
      return
    fi
    echo "ok   [package contract] pool.ts reads $name"
  done
}

test_both_deployments_count_the_whole_fleet
test_scaling_one_deployment_resizes_both
test_deployments_with_no_pods_are_not_counted
test_budget_defaults_to_the_chart_managed_limit
test_external_server_uses_the_clickhouse_default
test_operator_states_the_budget_once
test_budget_above_the_chart_managed_limit_is_refused
test_emitted_names_match_the_package_contract

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures ClickHouse pool-sizing check(s) failed"
  exit 1
fi

echo
echo "all ClickHouse pool-sizing checks pass"
