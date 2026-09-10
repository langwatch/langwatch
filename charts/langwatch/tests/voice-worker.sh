#!/usr/bin/env bash
#
# Renders the chart and asserts the opt-in voice worker (Deployment, Service,
# Ingress) behaves as documented: absent unless enabled, refusing to render
# without the two values it cannot work without, and shaped correctly once
# turned on.
#
# This executes the template pipeline rather than reading the templates: the
# gating conditions, the required-value checks, and the env/secretKeyRef
# wiring are only visible in what actually renders.
#
# See langwatch/langwatch#8015 and the env contract on #8014
# (voice-env-contract comment).
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/voice-worker.sh

set -euo pipefail

cd "$(dirname "$0")/.."

readonly BASE="--set autogen.enabled=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# autogen generates fresh random Secret values on every render, independent of
# voice — so a byte-identical comparison must normalise those out first, or
# every render pair would "differ" for a reason that has nothing to do with
# voice. Every such value is a long quoted base64 string; blank them all,
# consistently, on both sides being compared.
normalise() {
  sed -E 's/: "[A-Za-z0-9+\/=]{16,}"/: "<redacted>"/'
}

# Runs helm template with $BASE plus the given flags, printing combined
# stdout/stderr and preserving helm's exit status. The only place `$BASE`
# and a caller's flags are word-split, so the disable comment lives here once
# instead of on every call site.
render() {
  local out status
  # shellcheck disable=SC2086
  out=$(helm template lw . $BASE $1 2>&1)
  status=$?
  printf '%s' "$out"
  return $status
}

# @scenario "The voice worker is not deployed unless the operator turns it on"
test_default_has_no_voice_resources() {
  local out
  if ! out=$(render ""); then
    fail "default render" "chart failed to render at all: $(printf '%s' "$out" | tail -5)"
    return
  fi
  if printf '%s' "$out" | grep -q "templates/voice/"; then
    fail "default has no voice resources" "default render includes a templates/voice/ manifest"
    return
  fi
  echo "ok   [default has no voice resources] no templates/voice/ source in the default render"
}

# @scenario "Turning the voice worker off explicitly changes nothing"
test_explicit_false_matches_default() {
  local default_out explicit_out
  default_out=$(render "" | normalise)
  explicit_out=$(render "--set voice.enabled=false" | normalise)
  if [ "$default_out" != "$explicit_out" ]; then
    fail "explicit false matches default" \
      "rendered manifest differs between default and --set voice.enabled=false: $(diff <(printf '%s' "$default_out") <(printf '%s' "$explicit_out") | head -10 | tr '\n' ' ')"
    return
  fi
  echo "ok   [explicit false matches default] --set voice.enabled=false renders identically to the default"
}

# Renders a profile and prints only one component's manifest, so a value from
# another component can never satisfy an assertion.
render_component() {
  render "$2" | awk -v want="langwatch/templates/voice/$1" '
    $0 ~ "^# Source: " want { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab { print }
  '
}

readonly ENABLED_FLAGS="--set voice.enabled=true --set voice.publicBaseUrl=https://voice.example.com"

# @scenario "Turning on the voice worker brings up a single call handler"
test_enabled_renders_deployment() {
  local block
  block=$(render_component "deployment.yaml" "$ENABLED_FLAGS")
  if [ -z "$block" ]; then
    fail "voice deployment" "rendered no voice Deployment with voice.enabled=true"
    return
  fi
  if ! printf '%s' "$block" | grep -q "replicas: 1"; then
    fail "voice deployment replicas" "expected replicas: 1"
    return
  fi
  if ! printf '%s' "$block" | grep -A1 "name: VOICE_WORKER_ONLY" | grep -q 'value: "true"'; then
    fail "voice deployment VOICE_WORKER_ONLY" "expected VOICE_WORKER_ONLY=true"
    return
  fi
  echo "ok   [voice deployment] replicas=1, VOICE_WORKER_ONLY=true"
}

# @scenario "The voice worker's shutdown timing is its own, not borrowed from the background workers"
test_termination_grace_period_follows_voice_values() {
  local block
  block=$(render_component "deployment.yaml" \
    "$ENABLED_FLAGS --set voice.terminationGracePeriodSeconds=90 --set voice.shutdownDrainSeconds=60 --set workers.terminationGracePeriodSeconds=999")
  if [ -z "$block" ]; then
    fail "voice terminationGracePeriodSeconds" "rendered no voice Deployment with voice.enabled=true"
    return
  fi
  if ! printf '%s' "$block" | grep -q "terminationGracePeriodSeconds: 90"; then
    fail "voice terminationGracePeriodSeconds" "expected terminationGracePeriodSeconds: 90 (from voice.terminationGracePeriodSeconds), got: $(printf '%s' "$block" | grep terminationGracePeriodSeconds)"
    return
  fi
  echo "ok   [voice terminationGracePeriodSeconds] follows --set voice.terminationGracePeriodSeconds, not workers.*"
}

# @scenario "The voice worker is reachable inside the cluster by default, but not exposed publicly"
test_enabled_renders_service_no_ingress() {
  local svc ing
  svc=$(render_component "service.yaml" "$ENABLED_FLAGS")
  if [ -z "$svc" ]; then
    fail "voice service" "rendered no voice Service with voice.enabled=true"
    return
  fi
  if ! printf '%s' "$svc" | grep -q "targetPort: voice-ws"; then
    fail "voice service targetPort" "expected targetPort: voice-ws"
    return
  fi
  ing=$(render_component "ingress.yaml" "$ENABLED_FLAGS")
  if [ -n "$ing" ]; then
    fail "voice ingress absent by default" "voice.ingress.enabled defaults to false but an Ingress rendered anyway"
    return
  fi
  echo "ok   [voice service / no ingress] Service renders, Ingress does not (ingress.enabled defaults false)"
}

# @scenario "The voice worker gets its own public hostname for Twilio to call"
test_ingress_enabled_renders() {
  local ing
  ing=$(render_component "ingress.yaml" \
    "$ENABLED_FLAGS --set voice.ingress.enabled=true --set voice.ingress.host=voice.example.com")
  if [ -z "$ing" ]; then
    fail "voice ingress enabled" "rendered no voice Ingress with voice.ingress.enabled=true"
    return
  fi
  if ! printf '%s' "$ing" | grep -q "host: \"voice.example.com\""; then
    fail "voice ingress host" "expected host: \"voice.example.com\""
    return
  fi
  if ! printf '%s' "$ing" | grep -q "path: /twilio"; then
    fail "voice ingress path" "expected path: /twilio"
    return
  fi
  echo "ok   [voice ingress enabled] Ingress renders for voice.example.com at /twilio"
}

# @scenario "The voice worker refuses to expose a hostname that doesn't match its own public address"
test_ingress_host_mismatch_refuses() {
  local out
  if out=$(render "$ENABLED_FLAGS --set voice.ingress.enabled=true --set voice.ingress.host=other.example.com"); then
    fail "ingress host mismatch" "chart rendered when voice.ingress.host disagreed with voice.publicBaseUrl"
    return
  fi
  case "$out" in
    *"does not match the hostname in voice.publicBaseUrl"*)
      echo "ok   [ingress host mismatch] refused with the expected message" ;;
    *)
      fail "ingress host mismatch" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The voice worker refuses to start without knowing its own public address"
test_enabled_without_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.enabled=true"); then
    fail "missing publicBaseUrl" "chart rendered when voice.publicBaseUrl was not set"
    return
  fi
  case "$out" in
    *"voice.publicBaseUrl is required"*)
      echo "ok   [missing publicBaseUrl] refused with the expected message" ;;
    *)
      fail "missing publicBaseUrl" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

test_default_has_no_voice_resources
test_explicit_false_matches_default
test_enabled_renders_deployment
test_termination_grace_period_follows_voice_values
test_enabled_renders_service_no_ingress
test_ingress_enabled_renders
test_ingress_host_mismatch_refuses
test_enabled_without_public_base_url_refuses

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all voice-worker assertions passed"
