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

# @scenario "The default install renders no voice resources"
test_default_has_no_voice_resources() {
  local out
  if ! out=$(helm template lw . $BASE 2>&1); then
    fail "default render" "chart failed to render at all: $(printf '%s' "$out" | tail -5)"
    return
  fi
  if printf '%s' "$out" | grep -q "templates/voice/"; then
    fail "default has no voice resources" "default render includes a templates/voice/ manifest"
    return
  fi
  echo "ok   [default has no voice resources] no templates/voice/ source in the default render"
}

# @scenario "voice.enabled=false explicitly changes nothing"
test_explicit_false_matches_default() {
  local default_out explicit_out
  default_out=$(helm template lw . $BASE | normalise)
  explicit_out=$(helm template lw . $BASE --set voice.enabled=false | normalise)
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
  # shellcheck disable=SC2086
  helm template lw . $2 | awk -v want="langwatch/templates/voice/$1" '
    $0 ~ "^# Source: " want { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab { print }
  '
}

readonly ENABLED_FLAGS="--set voice.enabled=true --set voice.publicBaseUrl=https://voice.example.com --set voice.twilio.existingSecret=twilio"

# @scenario "Enabling voice renders a single-replica worker wired to the Twilio secret"
test_enabled_renders_deployment() {
  local block
  block=$(render_component "deployment.yaml" "$BASE $ENABLED_FLAGS")
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
  if ! printf '%s' "$block" | grep -A3 "name: TWILIO_ACCOUNT_SID" | grep -q "name: twilio"; then
    fail "voice deployment TWILIO_ACCOUNT_SID" "expected secretKeyRef to Secret 'twilio'"
    return
  fi
  if ! printf '%s' "$block" | grep -A4 "name: TWILIO_ACCOUNT_SID" | grep -q "key: TWILIO_ACCOUNT_SID"; then
    fail "voice deployment TWILIO_ACCOUNT_SID key" "expected secretKeyRef key TWILIO_ACCOUNT_SID"
    return
  fi
  if ! printf '%s' "$block" | grep -A3 "name: TWILIO_AUTH_TOKEN" | grep -q "name: twilio"; then
    fail "voice deployment TWILIO_AUTH_TOKEN" "expected secretKeyRef to Secret 'twilio'"
    return
  fi
  if ! printf '%s' "$block" | grep -A3 "name: TWILIO_FROM_NUMBER" | grep -q "name: twilio"; then
    fail "voice deployment TWILIO_FROM_NUMBER" "expected secretKeyRef to Secret 'twilio'"
    return
  fi
  echo "ok   [voice deployment] replicas=1, VOICE_WORKER_ONLY=true, Twilio secretKeyRefs present"
}

# @scenario "Enabling voice renders a Service but no Ingress by default"
test_enabled_renders_service_no_ingress() {
  local svc ing
  svc=$(render_component "service.yaml" "$BASE $ENABLED_FLAGS")
  if [ -z "$svc" ]; then
    fail "voice service" "rendered no voice Service with voice.enabled=true"
    return
  fi
  if ! printf '%s' "$svc" | grep -q "targetPort: voice-ws"; then
    fail "voice service targetPort" "expected targetPort: voice-ws"
    return
  fi
  ing=$(render_component "ingress.yaml" "$BASE $ENABLED_FLAGS")
  if [ -n "$ing" ]; then
    fail "voice ingress absent by default" "voice.ingress.enabled defaults to false but an Ingress rendered anyway"
    return
  fi
  echo "ok   [voice service / no ingress] Service renders, Ingress does not (ingress.enabled defaults false)"
}

# @scenario "Enabling the voice ingress renders it for the configured host"
test_ingress_enabled_renders() {
  local ing
  ing=$(render_component "ingress.yaml" \
    "$BASE $ENABLED_FLAGS --set voice.ingress.enabled=true --set voice.ingress.host=voice.example.com")
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

# @scenario "voice.enabled without publicBaseUrl refuses to render"
test_enabled_without_public_base_url_refuses() {
  local out
  if out=$(helm template lw . $BASE --set voice.enabled=true --set voice.twilio.existingSecret=twilio 2>&1); then
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

# @scenario "voice.enabled without an existing Twilio secret refuses to render"
test_enabled_without_twilio_secret_refuses() {
  local out
  if out=$(helm template lw . $BASE --set voice.enabled=true --set voice.publicBaseUrl=https://voice.example.com 2>&1); then
    fail "missing twilio secret" "chart rendered when voice.twilio.existingSecret was not set"
    return
  fi
  case "$out" in
    *"voice.twilio.existingSecret is required"*)
      echo "ok   [missing twilio secret] refused with the expected message" ;;
    *)
      fail "missing twilio secret" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

test_default_has_no_voice_resources
test_explicit_false_matches_default
test_enabled_renders_deployment
test_enabled_renders_service_no_ingress
test_ingress_enabled_renders
test_enabled_without_public_base_url_refuses
test_enabled_without_twilio_secret_refuses

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all voice-worker assertions passed"
