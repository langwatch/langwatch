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

# The drain backstop in App.close (CLOSE_DRAIN_TIMEOUT_MS), in seconds. The
# grace period has to cover this plus process teardown.
readonly DRAIN_BACKSTOP_SECONDS=25

# Secret autogen, so the chart's own secret validation lets a bare render
# through. Matches the other suites in this directory.
readonly BASE="--set autogen.enabled=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Renders a profile and prints only the workers Deployment, so a value from
# another component can never satisfy an assertion.
render_workers() {
  # shellcheck disable=SC2086
  helm template lw . $1 | awk '
    /^# Source: langwatch\/templates\/workers\/deployment\.yaml/ { grab=1 }
    grab && /^# Source:/ && !/workers\/deployment\.yaml/ { grab=0 }
    grab { print }
  '
}

grace_period_of() {
  printf '%s' "$1" | awk '
    /terminationGracePeriodSeconds:/ { print $2 }
  ' | head -n 1
}

# @scenario "The workers pod gets long enough to drain"
test_default_grace_period_covers_the_drain() {
  local block got
  block=$(render_workers "$BASE")
  if [ -z "$block" ]; then
    fail "default grace period" "rendered no workers Deployment"
    return
  fi
  got=$(grace_period_of "$block")
  if [ -z "$got" ]; then
    fail "default grace period" "terminationGracePeriodSeconds did not render at all"
    return
  fi
  if [ "$got" -le "$DRAIN_BACKSTOP_SECONDS" ]; then
    fail "default grace period" \
      "terminationGracePeriodSeconds is ${got}s, which does not cover the ${DRAIN_BACKSTOP_SECONDS}s drain backstop"
    return
  fi
  echo "ok   [default grace period] terminationGracePeriodSeconds=${got} covers the ${DRAIN_BACKSTOP_SECONDS}s drain backstop"
}

# @scenario "Operators can raise the grace period for a slower drain"
test_grace_period_is_overridable() {
  local block got
  block=$(render_workers "$BASE --set workers.terminationGracePeriodSeconds=180")
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

test_default_grace_period_covers_the_drain
test_grace_period_is_overridable

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all workers-shutdown assertions passed"
