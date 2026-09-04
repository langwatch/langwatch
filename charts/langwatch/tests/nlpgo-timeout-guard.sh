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

# Renders with the given flags and asserts all three callers carry $3.
expect_ceiling_everywhere() {
  local label="$1" flags="$2" expected="$3" values count
  if ! render "$flags"; then
    fail "$label" "render failed, expected $expected to be accepted: $render_out"
    return
  fi
  values=$(emitted_ceilings)
  count=$(emitted_ceiling_count)
  if [ "$values" != "$expected" ]; then
    fail "$label" "expected every caller to get $expected, got: $(echo "$values" | tr '\n' ' ')"
    return
  fi
  if [ "$count" != "3" ]; then
    fail "$label" "expected the app, the workers and the NLP service to carry it (3), got $count"
    return
  fi
  echo "ok   [$label] $expected carried by all $count callers"
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

# Helm's `int` reads a value it cannot parse as a whole number as 0, which
# clears every upper bound, and does not coerce a negative one at all — before
# the lower-bound guard, `abc` shipped a ceiling of 0 to all three callers and
# `-5` reached the deployment verbatim, both RC 0.
#
# An explicit 0 is the one unusable-looking value that cannot be refused here:
# `default 600` counts it as empty and substitutes the default before the check
# runs, so 0 is indistinguishable from unset and correctly yields 600.
# @scenario "A ceiling that is not a positive whole number refuses to render"
test_non_positive_ceiling_refuses_to_render() {
  expect_render_fails "ceiling (text)" \
    "--set langwatch_nlp.codeBlockTimeoutSeconds=abc"
  expect_render_fails "ceiling (negative)" \
    "--set langwatch_nlp.codeBlockTimeoutSeconds=-5"
  expect_render_fails "ceiling (fraction)" \
    "--set langwatch_nlp.codeBlockTimeoutSeconds=710.9"
  expect_render_fails "ceiling (exponent)" \
    "--set-string langwatch_nlp.codeBlockTimeoutSeconds=1e3"
  expect_render_fails "ceiling (past int64)" \
    "--set-string langwatch_nlp.codeBlockTimeoutSeconds=99999999999999999999"

  # Pinned alongside, so the guard cannot narrow what a valid ceiling is.
  expect_ceiling_everywhere "ceiling (explicit default)" \
    "--set langwatch_nlp.codeBlockTimeoutSeconds=600" 600
  expect_ceiling_everywhere "ceiling (at the maximum)" \
    "--set langwatch_nlp.codeBlockTimeoutSeconds=710" 710
  expect_ceiling_everywhere "ceiling (explicit zero)" \
    "--set langwatch_nlp.codeBlockTimeoutSeconds=0" 600
}

# @scenario "The chart's ceiling matches the Lambda clamp's ceiling exactly"
test_ceiling_matches_the_lambda_clamp_boundary() {
  local values
  if ! render "--set langwatch_nlp.codeBlockTimeoutSeconds=710"; then
    fail "at the Lambda-clamp ceiling" "render failed, expected 710 to be accepted: $render_out"
    return
  fi
  values=$(emitted_ceilings)
  if [ "$values" != "710" ]; then
    fail "at the Lambda-clamp ceiling" "expected every caller to get 710, got: $(echo "$values" | tr '\n' ' ')"
    return
  fi
  echo "ok   [at the Lambda-clamp ceiling] 710 accepted and carried by all callers"

  expect_render_fails "one above the Lambda-clamp ceiling" "--set langwatch_nlp.codeBlockTimeoutSeconds=711"
}

# @scenario "The ceiling is still checked when the NLP service is external"
test_ceiling_is_checked_with_the_service_disabled() {
  # Both directions: too high is caught by the range check, and ANY change is
  # caught because the chart cannot impose it on an engine it does not deploy.
  # Before the check moved out of the NLP Deployment, both of these rendered
  # cleanly and shipped the number to the app and the workers anyway.
  expect_render_fails "external, above idle timeout" \
    "--set langwatch_nlp.enabled=false --set langwatch_nlp.codeBlockTimeoutSeconds=900"

  # A shortened ceiling is a legal external-engine config: the operator sets the
  # real ceiling on their own service and matches it here. The chart cannot see
  # that value, so it passes this through instead of guessing.
  local values
  if ! render "--set langwatch_nlp.enabled=false --set langwatch_nlp.codeBlockTimeoutSeconds=60"; then
    fail "external, shortened" "render failed, expected a shortened external ceiling to be allowed: $render_out"
    return
  fi
  values=$(emitted_ceilings)
  if [ "$values" != "60" ]; then
    fail "external, shortened" "expected every caller to get 60, got: $(echo "$values" | tr '\n' ' ')"
    return
  fi
  echo "ok   [external, shortened] a matched external ceiling is passed through"
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
test_non_positive_ceiling_refuses_to_render
test_ceiling_matches_the_lambda_clamp_boundary
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
