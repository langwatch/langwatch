#!/usr/bin/env bash
#
# Renders the chart and asserts what the evaluations service actually receives:
# the worker count computed from its CPU allowance, and a memory ceiling that
# count can live within.
#
# This executes the template pipeline rather than reading it. The helper does
# real arithmetic on a Kubernetes CPU quantity (dig -> trimSuffix -> divf ->
# ceil -> max), so a `ceil` that becomes `floor`, a unit that stops being
# parsed, or any edit that breaks rendering outright is only visible by
# rendering. Grepping the template for "ceil" proves nothing about the number
# that lands in the pod.
#
# Why the number matters: the service loads its own copy of every local model
# per worker (~2.1Gi). Sized from the node's cores instead of the container's
# it reached 11Gi on an 8-vCPU node and was OOM-killed at the chart's own 8Gi
# default. See specs/setup/helm-langevals-worker-pool.feature.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment directly above the test function it verifies.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/langevals-sizing.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# One worker holding every local model, measured on the published images.
readonly SINGLE_WORKER_LOADED_MIB=2571

failures=0

# Renders a profile and prints only the evaluations Deployment, so a value from
# another component can never satisfy an assertion.
render_langevals() {
  # shellcheck disable=SC2086
  helm template lw . $1 | awk '
    /^# Source: langwatch\/templates\/langevals\/deployment\.yaml/ { grab=1 }
    grab && /^# Source:/ && !/langevals\/deployment\.yaml/ { grab=0 }
    grab { print }
  '
}

# No early `exit` in awk: it would close the pipe under `set -o pipefail` and
# the producer would die on SIGPIPE. Take the first match at the end instead.
cpu_count_of() {
  printf '%s' "$1" | awk '
    /name: CPU_COUNT/ { want=1; next }
    want && /value:/ { gsub(/"/,"",$2); print $2; want=0 }
  ' | head -n 1
}

memory_limit_of() {
  printf '%s' "$1" | awk '
    /limits:/ { f=1; next }
    f && /memory:/ { gsub(/"/,"",$2); print $2; f=0 }
  ' | head -n 1
}

to_mib() {
  case "$1" in
    *Gi) echo $(( ${1%Gi} * 1024 )) ;;
    *Mi) echo "${1%Mi}" ;;
    *G)  echo $(( ${1%G} * 1024 )) ;;
    *M)  echo "${1%M}" ;;
    *)   echo "UNPARSEABLE" ;;
  esac
}

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Asserts the rendered worker count for one set of helm flags.
expect_cpu_count() {
  local label="$1" flags="$2" want="$3" block got
  block=$(render_langevals "$flags")
  if [ -z "$block" ]; then
    fail "$label" "rendered no langevals Deployment"
    return
  fi
  got=$(cpu_count_of "$block")
  if [ "$got" != "$want" ]; then
    fail "$label" "CPU_COUNT is '${got:-<absent>}', expected '$want'"
    return
  fi
  echo "ok   [$label] CPU_COUNT=$got"
}

# Asserts both the worker count and that the ceiling covers that many workers,
# each of which can end up holding every local model.
expect_profile() {
  local label="$1" flags="$2" want="$3" block got limit limit_mib need
  block=$(render_langevals "$flags")
  if [ -z "$block" ]; then
    fail "$label" "rendered no langevals Deployment"
    return
  fi
  got=$(cpu_count_of "$block")
  if [ "$got" != "$want" ]; then
    fail "$label" "CPU_COUNT is '${got:-<absent>}', expected '$want'"
    return
  fi
  limit=$(memory_limit_of "$block")
  limit_mib=$(to_mib "$limit")
  if [ "$limit_mib" = "UNPARSEABLE" ]; then
    fail "$label" "could not parse memory limit '$limit'"
    return
  fi
  need=$((SINGLE_WORKER_LOADED_MIB * want))
  if [ "$limit_mib" -lt "$need" ]; then
    fail "$label" "memory limit $limit (${limit_mib}Mi) is below ${need}Mi needed by $want worker(s)"
    return
  fi
  echo "ok   [$label] CPU_COUNT=$got limit=$limit"
}

# @scenario "A profile that asks for a fraction of a core gets a single worker"
test_fraction_of_a_core_gets_one_worker() {
  expect_profile "size-dev" "--set autogen.enabled=true -f examples/overlays/size-dev.yaml" 1
  expect_profile "size-minimal" "--set autogen.enabled=true -f examples/overlays/size-minimal.yaml" 1
  expect_profile "values-local" "-f examples/values-local.yaml" 1
  expect_profile "values-test" "-f examples/values-test.yaml" 1
}

# @scenario "A profile that asks for more CPU gets a proportionally larger pool"
test_more_cpu_gets_a_larger_pool() {
  expect_profile "default" "--set autogen.enabled=true" 2
  expect_profile "size-prod" "--set autogen.enabled=true -f examples/overlays/size-prod.yaml" 2
  expect_profile "size-ha" "--set autogen.enabled=true -f examples/overlays/size-ha.yaml" 2
  expect_profile "values-hosted-prod" "-f examples/values-hosted-prod.yaml" 2
  expect_profile "values-scalable-prod" "-f examples/values-scalable-prod.yaml" 2
}

# @scenario "A fractional allowance rounds up to a whole worker"
test_fractional_allowance_rounds_up() {
  # No shipped profile uses a fractional limit above one core, so without these
  # `ceil` could become `floor` and every profile above would still render the
  # same number. Memory is not asserted: overriding CPU alone is not a
  # configuration anyone ships.
  expect_cpu_count "cpu=1500m" "--set autogen.enabled=true --set langevals.resources.limits.cpu=1500m" 2
  expect_cpu_count "cpu=2500m" "--set autogen.enabled=true --set langevals.resources.limits.cpu=2500m" 3
  expect_cpu_count "cpu=250m" "--set autogen.enabled=true --set langevals.resources.limits.cpu=250m" 1
  expect_cpu_count "cpu=1m" "--set autogen.enabled=true --set langevals.resources.limits.cpu=1m" 1
  expect_cpu_count "cpu=4" "--set autogen.enabled=true --set langevals.resources.limits.cpu=4" 4
}

# @scenario "An operator who sets the worker count keeps it"
test_operator_override_wins_and_is_not_duplicated() {
  # Two CPU_COUNT entries in one container is undefined-enough behaviour that
  # "the last one wins" is not something to rely on.
  local block count value
  block=$(render_langevals "--set autogen.enabled=true --set langevals.extraEnvs[0].name=CPU_COUNT --set langevals.extraEnvs[0].value=6")
  count=$(printf '%s' "$block" | grep -c 'name: CPU_COUNT' || true)
  value=$(cpu_count_of "$block")

  if [ "$count" != "1" ]; then
    fail "operator override" "CPU_COUNT appears $count times, expected exactly 1"
    return
  fi
  if [ "$value" != "6" ]; then
    fail "operator override" "CPU_COUNT is '$value', expected the operator's '6'"
    return
  fi
  echo "ok   [operator override] CPU_COUNT=$value, emitted once"
}

test_fraction_of_a_core_gets_one_worker
test_more_cpu_gets_a_larger_pool
test_fractional_allowance_rounds_up
test_operator_override_wins_and_is_not_duplicated

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures langevals sizing check(s) failed"
  exit 1
fi

echo
echo "all langevals sizing checks pass"
