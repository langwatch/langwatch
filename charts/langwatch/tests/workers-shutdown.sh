#!/usr/bin/env bash
#
# Renders the chart and asserts the workers pod is given long enough to drain
# before Kubernetes escalates to SIGKILL.
#
# This executes the template pipeline rather than reading it: the value comes
# from a `default` pipeline over an optional values key, so a rename, a typo in
# the path, or an override that silently stops taking effect is only visible by
# rendering.
#
# Why the number matters: SIGTERM starts a real drain in the worker, unlike a
# stateless web pod. The GroupQueue stops dispatching and waits for in-flight
# jobs to finish their ClickHouse writes (20s budget in production, 25s
# backstop in App.close), and process teardown follows that. Under the k8s
# default of 30s the drain could be cut short by SIGKILL, severing in-flight
# statements — which ClickHouse reports as `Broken pipe, while writing to
# socket ... ParallelFormattingOutputFormat` and the worker reports as
# `socket hang up`. See specs/event-sourcing/worker-graceful-shutdown.feature.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies — the next
# line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/workers-shutdown.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# The default drain budget (workers.shutdownDrainSeconds) and the fixed margin
# above it: 5s for App.close, 15s for process teardown, 10s of kubelet slack.
# Mirrors platform/app/src/server/shutdown/budget.ts.
readonly DRAIN_SECONDS=20
readonly REQUIRED_MARGIN_SECONDS=30

# Secret autogen, so the chart's own secret validation lets a bare render
# through. Matches the other suites in this directory.
readonly BASE="--set autogen.enabled=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Renders a profile and prints only one component's Deployment, so a value
# from another component can never satisfy an assertion.
render_component() {
  # shellcheck disable=SC2086
  helm template lw . $2 | awk -v want="langwatch/templates/$1/deployment.yaml" '
    $0 ~ "^# Source: " want { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab { print }
  '
}

grace_period_of() {
  printf '%s' "$1" | awk '
    /terminationGracePeriodSeconds:/ { print $2 }
  ' | head -n 1
}

# Asserts one component's rendered grace period covers the drain plus margin.
expect_covers_drain() {
  local label="$1" component="$2" block got required
  required=$((DRAIN_SECONDS + REQUIRED_MARGIN_SECONDS))
  block=$(render_component "$component" "$BASE")
  if [ -z "$block" ]; then
    fail "$label" "rendered no $component Deployment"
    return
  fi
  got=$(grace_period_of "$block")
  if [ -z "$got" ]; then
    fail "$label" "terminationGracePeriodSeconds did not render at all"
    return
  fi
  if [ "$got" -lt "$required" ]; then
    fail "$label" \
      "terminationGracePeriodSeconds is ${got}s, below the ${required}s a ${DRAIN_SECONDS}s drain needs"
    return
  fi
  echo "ok   [$label] terminationGracePeriodSeconds=${got} covers ${DRAIN_SECONDS}s drain + ${REQUIRED_MARGIN_SECONDS}s"
}

# Asserts the chart REFUSES to render, and that the message names both numbers.
# A guard that fails for the wrong reason is indistinguishable from one that
# works until the day someone relies on it.
expect_render_refused() {
  local label="$1" flags="$2" expect="$3" out
  if out=$(helm template lw . $BASE $flags 2>&1); then
    fail "$label" "chart rendered when it should have refused"
    return
  fi
  case "$out" in
    *"$expect"*)
      echo "ok   [$label] refused: ${expect}" ;;
    *)
      fail "$label" "refused, but not for the expected reason. Got: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The workers pod gets long enough to drain"
test_workers_grace_period_covers_the_drain() {
  expect_covers_drain "workers grace period" "workers"
}

# @scenario "The app pod gets the same budget as the workers"
test_app_grace_period_covers_the_drain() {
  expect_covers_drain "app grace period" "app"
}

# @scenario "Operators can raise the grace period for a slower drain"
test_grace_period_is_overridable() {
  local block got
  block=$(render_component "workers" "$BASE --set workers.terminationGracePeriodSeconds=180")
  if [ -z "$block" ]; then
    fail "grace period override" "rendered no workers Deployment"
    return
  fi
  got=$(grace_period_of "$block")
  if [ "$got" != "180" ]; then
    fail "grace period override" \
      "terminationGracePeriodSeconds is '${got:-<absent>}', expected the overridden 180"
    return
  fi
  echo "ok   [grace period override] terminationGracePeriodSeconds=$got"
}

# @scenario "A grace period too short for the drain refuses to render"
test_short_grace_period_refuses_to_render() {
  expect_render_refused "short grace period" \
    "--set workers.terminationGracePeriodSeconds=30" \
    "it needs at least 50"
}

# @scenario "Raising the drain budget alone refuses to render"
test_raised_drain_alone_refuses_to_render() {
  expect_render_refused "drain raised alone" \
    "--set workers.shutdownDrainSeconds=60" \
    "too short for a 60s shutdown drain"
}

# Raising both together is the supported path and must still render.
test_raising_both_together_renders() {
  local block got
  block=$(render_component "workers" \
    "$BASE --set workers.shutdownDrainSeconds=60 --set workers.terminationGracePeriodSeconds=90")
  got=$(grace_period_of "$block")
  if [ "$got" != "90" ]; then
    fail "raise both" "terminationGracePeriodSeconds is '${got:-<absent>}', expected 90"
    return
  fi
  echo "ok   [raise both] a 60s drain with a 90s grace period renders"
}

test_workers_grace_period_covers_the_drain
test_app_grace_period_covers_the_drain
test_grace_period_is_overridable
test_short_grace_period_refuses_to_render
test_raised_drain_alone_refuses_to_render
test_raising_both_together_renders

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all workers-shutdown assertions passed"
