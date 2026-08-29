#!/usr/bin/env bash
#
# Renders the chart and asserts what every process that talks to nlpgo receives
# as its code-block ceiling, and which ceilings the chart refuses outright.
#
# Why rendering: the ceiling is emitted by `langwatch.sharedEnv`, which feeds
# the app and the workers, and separately by the NLP Deployment. Only the
# render shows that all three carry the SAME checked number — and, critically,
# that the check still runs when `langwatch_nlp.enabled` is false, a supported
# mode (external, shared or serverless nlpgo) in which the NLP Deployment, and
# so any guard living inside it, is not rendered at all. The app and workers
# derive their fetch deadline from this number in that mode too, so a guard
# that stops applying there hands them a ceiling nobody checked and they abort
# turns the external engine is still working on.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/nlpgo-timeout-guard.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1] $2" >&2
  failures=$((failures + 1))
}

# Renders with the given flags and prints RC only; output is kept in $render_out.
render() {
  # shellcheck disable=SC2086
  render_out=$(helm template lw . --set autogen.enabled=true $1 2>&1)
}

expect_render_fails() {
  local label="$1" flags="$2"
  if render "$flags"; then
    fail "$label" "render succeeded, expected the chart to refuse it"
    return
  fi
  echo "ok   [$label] chart refused the value"
}

# Every distinct NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS value in the render,
# one per line. A disagreement between components shows up as two lines.
emitted_ceilings() {
  printf '%s' "$render_out" |
    grep -A1 'name: NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS' |
    awk '/value:/ { gsub(/"/, "", $2); print $2 }' |
    sort -u
}

emitted_ceiling_count() {
  printf '%s' "$render_out" |
    grep -c 'name: NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS' || true
}

# @scenario "Every nlpgo caller is given the same code-block ceiling"
test_default_ceiling_reaches_every_caller() {
  local values count
  if ! render ""; then
    fail "default ceiling" "default render failed: $render_out"
    return
  fi
  values=$(emitted_ceilings)
  count=$(emitted_ceiling_count)

  if [ "$values" != "600" ]; then
    fail "default ceiling" "components disagree, got: $(echo "$values" | tr '\n' ' ')"
    return
  fi
  if [ "$count" != "3" ]; then
    fail "default ceiling" "expected the app, the workers and the NLP service to carry it (3), got $count"
    return
  fi
  echo "ok   [default ceiling] 600 carried by all $count callers"
}

# @scenario "A code-block ceiling at or above the stream idle timeout is refused"
test_ceiling_above_stream_idle_timeout_is_refused() {
  expect_render_fails "at idle timeout" "--set langwatch_nlp.codeBlockTimeoutSeconds=720"
  expect_render_fails "above idle timeout" "--set langwatch_nlp.codeBlockTimeoutSeconds=900"
}

# @scenario "The ceiling is still checked when the NLP service is external"
test_ceiling_is_checked_with_the_service_disabled() {
  # Both directions: too high is caught by the range check, and ANY change is
  # caught because the chart cannot impose it on an engine it does not deploy.
  # Before the check moved out of the NLP Deployment, both of these rendered
  # cleanly and shipped the number to the app and the workers anyway.
  expect_render_fails "external, above idle timeout" \
    "--set langwatch_nlp.enabled=false --set langwatch_nlp.codeBlockTimeoutSeconds=900"
  expect_render_fails "external, shortened" \
    "--set langwatch_nlp.enabled=false --set langwatch_nlp.codeBlockTimeoutSeconds=60"
}

# @scenario "An external NLP service still leaves the clients installable"
test_external_service_renders_on_the_default() {
  local values
  if ! render "--set langwatch_nlp.enabled=false"; then
    fail "external default" "render failed: $render_out"
    return
  fi
  values=$(emitted_ceilings)
  if [ "$values" != "600" ]; then
    fail "external default" "expected the engine's own default, got: $(echo "$values" | tr '\n' ' ')"
    return
  fi
  echo "ok   [external default] clients keep the engine's own 600"
}

# @scenario "A reserved timeout variable cannot be smuggled in through extraEnvs"
test_reserved_timeout_envs_are_refused_everywhere() {
  local component var
  for component in app workers langwatch_nlp; do
    for var in NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS; do
      expect_render_fails "$component.extraEnvs $var" \
        "--set ${component}.extraEnvs[0].name=${var} --set ${component}.extraEnvs[0].value=5"
    done
  done
}

test_default_ceiling_reaches_every_caller
test_ceiling_above_stream_idle_timeout_is_refused
test_ceiling_is_checked_with_the_service_disabled
test_external_service_renders_on_the_default
test_reserved_timeout_envs_are_refused_everywhere

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures nlpgo timeout guard check(s) failed"
  exit 1
fi

echo
echo "all nlpgo timeout guard checks pass"
