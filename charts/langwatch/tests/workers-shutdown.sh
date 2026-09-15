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
# Why the numbers matter: SIGTERM starts a real drain in the worker, unlike a
# stateless web pod. The GroupQueue stops dispatching and waits for in-flight
# jobs to finish their ClickHouse writes (25s in production), and process
# teardown follows that. Under the k8s default of 30s the drain could be cut
# short by SIGKILL, severing in-flight statements — which ClickHouse reports as
# `Broken pipe, while writing to socket ... ParallelFormattingOutputFormat` and
# the worker reports as `socket hang up`.
#
# The suite asserts both halves of the pair: the pod's grace period, and the
# SHUTDOWN_DRAIN_TIMEOUT_MS the process is given. Both come from one value, and
# a process running a budget its pod was not sized for is the whole failure.
# See specs/background/worker-graceful-shutdown.feature.
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
# above it: 5s for the close backstop, 15s for process teardown, 10s of kubelet
# slack. Mirrors apps/worker/src/platform/config/worker.config.ts and
# apps/api/src/platform/config/api.config.ts, which derive the same numbers.
readonly DRAIN_SECONDS=25
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
  # Guard the extraction, not just its emptiness: `[ "$got" -lt N ]` on a
  # non-numeric value exits 2, which reads as "not less than" inside `if` and
  # would print ok for a garbled render.
  case "$got" in
    '' | *[!0-9]*)
      fail "$label" "terminationGracePeriodSeconds did not render as a number (got '${got:-<absent>}')"
      return
      ;;
  esac
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

# The two processes read the drain budget under different names: the worker
# drains its queue (SHUTDOWN_DRAIN_TIMEOUT_MS), the API drains live HTTP
# requests (API_HTTP_DRAIN_GRACE_MS). Asserting one name against both pods would
# pass on whichever pod happened to carry it and prove nothing about the other.
drain_env_of() {
  printf '%s' "$1" | awk -v var="$2" '
    $0 ~ ("name: " var "$") { want=1; next }
    want && /value:/ { gsub(/"/,"",$2); print $2; want=0 }
  ' | head -n 1
}

drain_var_of() {
  case "$1" in
    app) echo "API_HTTP_DRAIN_GRACE_MS" ;;
    *) echo "SHUTDOWN_DRAIN_TIMEOUT_MS" ;;
  esac
}

# The pod is sized for a drain the process must be told about. A process
# running a budget its pod was not sized for is the drift this pair exists to
# prevent — the kubelet SIGKILLs a drain the process still thinks it has time
# for — so assert they came from the same value rather than merely both being
# present.
expect_drain_env_matches() {
  local label="$1" component="$2" flags="$3" want="$4" block got var
  var=$(drain_var_of "$component")
  block=$(render_component "$component" "$BASE $flags")
  got=$(drain_env_of "$block" "$var")
  if [ "$got" != "$want" ]; then
    fail "$label" "$var is '${got:-<absent>}', expected $want"
    return
  fi
  echo "ok   [$label] $var=$got"
}

# @scenario "The process is told the same drain budget the pod is sized for"
test_drain_env_matches_the_pod() {
  expect_drain_env_matches "workers drain env" "workers" "" "$((DRAIN_SECONDS * 1000))"
  expect_drain_env_matches "app drain env" "app" "" "$((DRAIN_SECONDS * 1000))"
  expect_drain_env_matches "raised drain env" "workers" \
    "--set workers.shutdownDrainSeconds=60 --set workers.terminationGracePeriodSeconds=90" \
    "60000"
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
  # Names the component, not just the number: an app-side failure would
  # otherwise satisfy a workers-side assertion.
  expect_render_refused "short grace period" \
    "--set workers.terminationGracePeriodSeconds=30" \
    "workers.terminationGracePeriodSeconds is 30"
}

# A value Helm keeps as a string renders `int` 0 — a zero drain the app rejects
# at boot, while the required grace period collapses to the bare margin so the
# guard passes. The render must refuse instead of shipping a crashloop.
# @scenario "A drain budget that is not a positive whole number refuses to render"
test_junk_drain_refuses_to_render() {
  expect_render_refused "junk drain (fraction)" \
    "--set-string workers.shutdownDrainSeconds=25.9" \
    "must be a whole number of seconds greater than zero"
  expect_render_refused "junk drain (text)" \
    "--set-string workers.shutdownDrainSeconds=abc" \
    "must be a whole number of seconds greater than zero"
  expect_render_refused "junk drain (zero)" \
    "--set workers.shutdownDrainSeconds=0" \
    "must be a whole number of seconds greater than zero"
  expect_render_refused "junk drain (negative)" \
    "--set workers.shutdownDrainSeconds=-5" \
    "must be a whole number of seconds greater than zero"
}

# @scenario "The drain budget cannot be overridden behind the pod's back"
test_extra_envs_cannot_override_the_drain() {
  expect_render_refused "extraEnvs override" \
    "--set workers.extraEnvs[0].name=SHUTDOWN_DRAIN_TIMEOUT_MS --set-string workers.extraEnvs[0].value=120000" \
    "must not be set through extraEnvs"
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
test_drain_env_matches_the_pod
test_grace_period_is_overridable
test_short_grace_period_refuses_to_render
test_raised_drain_alone_refuses_to_render
test_junk_drain_refuses_to_render
test_extra_envs_cannot_override_the_drain
test_raising_both_together_renders

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all workers-shutdown assertions passed"
