#!/usr/bin/env bash
#
# Renders the gateway chart and asserts what the pod actually receives for
# shutdown: the two drain settings reaching the container as the env vars
# serve.go reads, and the two ways a values file can ask for a drain the pod
# will not survive.
#
# This executes the template pipeline rather than reading it. A grep for the
# key names passes just as happily when the ConfigMap carries them under a
# name the Go side never reads, and a values file whose drain timing exceeds
# terminationGracePeriodSeconds renders perfectly valid YAML: the only signal
# is a pod killed mid-drain, in production, on a rolling deploy.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies. The next
# line that is neither blank nor a comment must be that function.
#
# Usage (from charts/gateway):
#   ./tests/shutdown-values.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# The rendered chart, or nothing at all if the render failed. Swallowing the
# failure here keeps `set -e` from ending the run before the assertion that
# called it can report which case broke.
render() {
  # shellcheck disable=SC2086
  { helm template gateway . $1 --dry-run 2>/dev/null || true; }
}

# The `Error:` line helm prints when a template calls fail, flattened to one
# line so a case statement can match against it.
render_error() {
  # shellcheck disable=SC2086
  helm template gateway . $1 --dry-run 2>&1 | sed -n '/^Error:/,$p' | grep -v '^Use --debug' | tr '\n' ' ' || true
}

# The value of one key in the rendered ConfigMap.
configmap_value_of() {
  local flags="$1" key="$2"
  render "$flags" | awk -v want="$key" '
    $0 ~ "^# Source: langwatch-gateway/templates/configmap.yaml" { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab && $1 == want":" { gsub(/^"|"$/, "", $2); print $2; exit }
  '
}

# @scenario "the drain timing an operator sets is what the pod runs with"
test_drain_timing_reaches_the_configmap() {
  local drain graceful
  drain=$(configmap_value_of "" "SERVER_DRAIN_DELAY_SECONDS")
  graceful=$(configmap_value_of "" "SERVER_GRACEFUL_SECONDS")

  if [ "$drain" != "5" ]; then
    fail "drain delay" "SERVER_DRAIN_DELAY_SECONDS is '${drain:-<absent>}', expected the shutdown.preDrainWaitSeconds default of 5"
  else
    echo "ok   [drain delay] SERVER_DRAIN_DELAY_SECONDS=$drain"
  fi

  if [ "$graceful" != "60" ]; then
    fail "graceful window" "SERVER_GRACEFUL_SECONDS is '${graceful:-<absent>}', expected the shutdown.timeoutSeconds default of 60"
  else
    echo "ok   [graceful window] SERVER_GRACEFUL_SECONDS=$graceful"
  fi

  # An override has to travel too. A ConfigMap that hardcoded the defaults
  # would satisfy every assertion above. The grace period moves with it,
  # because widening the drain past what the pod is granted is refused.
  drain=$(configmap_value_of "--set shutdown.preDrainWaitSeconds=9 --set terminationGracePeriodSeconds=90" "SERVER_DRAIN_DELAY_SECONDS")
  if [ "$drain" != "9" ]; then
    fail "drain delay override" "SERVER_DRAIN_DELAY_SECONDS is '${drain:-<absent>}' after --set shutdown.preDrainWaitSeconds=9"
  else
    echo "ok   [drain delay override] SERVER_DRAIN_DELAY_SECONDS=$drain"
  fi
}

# @scenario "the duration-string shutdown keys are refused by the chart"
test_the_duration_string_keys_are_refused() {
  local entry key err
  for entry in "preDrainWait=5s" "timeout=15s"; do
    key="${entry%%=*}"
    err=$(render_error "--set shutdown.$entry")
    case "$err" in
      *"shutdown.${key}Seconds"*)
        echo "ok   [shutdown.$key] render refused, naming shutdown.${key}Seconds"
        ;;
      "")
        fail "shutdown.$key" "the values file rendered instead of failing; the legacy-key guard is gone"
        ;;
      *)
        fail "shutdown.$key" "render failed without naming the replacement key: $err"
        ;;
    esac
  done
}

# @scenario "a drain budget wider than the pod's grace period is refused"
test_an_unsurvivable_drain_budget_is_refused() {
  local err

  # 5 + 90 + 10 needs 105, and terminationGracePeriodSeconds stays at its
  # default of 75: the kubelet would SIGKILL 30s into the timeout.
  err=$(render_error "--set shutdown.timeoutSeconds=90")
  case "$err" in
    *"terminationGracePeriodSeconds"*105*)
      echo "ok   [timeout override] render refused, naming the 105s it needs"
      ;;
    "")
      fail "timeout override" "shutdown.timeoutSeconds=90 rendered against a 75s grace period"
      ;;
    *)
      fail "timeout override" "render failed without naming the required grace period: $err"
      ;;
  esac

  err=$(render_error "--set shutdown.preDrainWaitSeconds=30")
  case "$err" in
    *"terminationGracePeriodSeconds"*100*)
      echo "ok   [drain override] render refused, naming the 100s it needs"
      ;;
    "")
      fail "drain override" "shutdown.preDrainWaitSeconds=30 rendered against a 75s grace period"
      ;;
    *)
      fail "drain override" "render failed without naming the required grace period: $err"
      ;;
  esac

  # Raising the grace period alongside the drain is the documented way out,
  # and it has to actually work: a guard that cannot be satisfied is a guard
  # operators route around by pinning an old chart.
  if [ -z "$(render "--set shutdown.timeoutSeconds=90 --set terminationGracePeriodSeconds=105")" ]; then
    fail "matched override" "raising terminationGracePeriodSeconds to the required 105 still did not render"
  else
    echo "ok   [matched override] a grace period raised to match renders"
  fi
}

# @scenario "preDrainWaitSeconds + timeoutSeconds MUST be within terminationGracePeriodSeconds"
test_the_default_grace_period_covers_the_default_drain() {
  local grace_period required
  grace_period=$(render "" | awk '/terminationGracePeriodSeconds:/ { print $2; exit }')
  required=$(( 5 + 60 + 10 ))

  if [ -z "$grace_period" ]; then
    fail "default grace period" "terminationGracePeriodSeconds did not render at all"
  elif [ "$grace_period" -lt "$required" ]; then
    fail "default grace period" "terminationGracePeriodSeconds is $grace_period, below the $required the default drain needs"
  else
    echo "ok   [default grace period] terminationGracePeriodSeconds=$grace_period covers the ${required}s default drain"
  fi
}

test_drain_timing_reaches_the_configmap
test_the_duration_string_keys_are_refused
test_an_unsurvivable_drain_budget_is_refused
test_the_default_grace_period_covers_the_default_drain

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all gateway shutdown assertions passed"
