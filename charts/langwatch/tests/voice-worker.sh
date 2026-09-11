#!/usr/bin/env bash
#
# Renders the chart and asserts the voice worker (Deployment, Service,
# Ingress) behaves as documented: on by default but rendering nothing until a
# public https:// origin resolves (from voice.publicBaseUrl or, failing
# that, app.http.publicUrl), refusing to render only on an explicit bad
# value, and shaped correctly once a public address is in play.
#
# This executes the template pipeline rather than reading the templates: the
# gating conditions, the resolution priority, the required-value checks, and
# the env/secretKeyRef wiring are only visible in what actually renders.
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
# voice, so a byte-identical comparison must normalise those out first, or
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

# @scenario "Turning on the voice worker with a valid https:// public address renders"
test_default_has_no_voice_resources() {
  local out
  if ! out=$(render ""); then
    fail "default render" "chart failed to render at all: $(printf '%s' "$out" | tail -5)"
    return
  fi
  if printf '%s' "$out" | grep -q "templates/voice/"; then
    fail "default has no voice resources" "default render (no https:// public URL configured anywhere) includes a templates/voice/ manifest"
    return
  fi
  echo "ok   [default has no voice resources] stock install (voice.enabled=true, no https:// URL resolvable) renders no templates/voice/ source"
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

readonly ENABLED_FLAGS="--set voice.publicBaseUrl=https://voice.example.com"

# @scenario "Turning on the voice worker brings up a single call handler"
test_enabled_renders_deployment() {
  local block
  block=$(render_component "deployment.yaml" "$ENABLED_FLAGS")
  if [ -z "$block" ]; then
    fail "voice deployment" "rendered no voice Deployment with voice.publicBaseUrl set"
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
    fail "voice terminationGracePeriodSeconds" "rendered no voice Deployment with voice.publicBaseUrl set"
    return
  fi
  if ! printf '%s' "$block" | grep -q "terminationGracePeriodSeconds: 90"; then
    fail "voice terminationGracePeriodSeconds" "expected terminationGracePeriodSeconds: 90 (from voice.terminationGracePeriodSeconds), got: $(printf '%s' "$block" | grep terminationGracePeriodSeconds)"
    return
  fi
  echo "ok   [voice terminationGracePeriodSeconds] follows --set voice.terminationGracePeriodSeconds, not workers.*"
}

# @scenario "The voice worker is reachable inside the cluster by default, but not exposed publicly"
test_enabled_renders_service_and_ingress_by_default() {
  local svc ing
  svc=$(render_component "service.yaml" "$ENABLED_FLAGS")
  if [ -z "$svc" ]; then
    fail "voice service" "rendered no voice Service with voice.publicBaseUrl set"
    return
  fi
  if ! printf '%s' "$svc" | grep -q "targetPort: voice-ws"; then
    fail "voice service targetPort" "expected targetPort: voice-ws"
    return
  fi
  # voice.ingress.enabled now defaults to true, so a resolved public URL is
  # enough on its own to get an Ingress with no extra values set.
  ing=$(render_component "ingress.yaml" "$ENABLED_FLAGS")
  if [ -z "$ing" ]; then
    fail "voice ingress renders by default" "voice.ingress.enabled defaults to true but no Ingress rendered with voice.publicBaseUrl set"
    return
  fi
  echo "ok   [voice service / ingress by default] Service and Ingress both render with zero extra ingress config"
}

# @scenario "The voice worker gets its own public hostname for Twilio to call"
test_ingress_host_defaults_to_public_base_url_hostname() {
  local ing
  ing=$(render_component "ingress.yaml" "$ENABLED_FLAGS")
  if [ -z "$ing" ]; then
    fail "voice ingress default host" "rendered no voice Ingress with voice.publicBaseUrl set"
    return
  fi
  if ! printf '%s' "$ing" | grep -q "host: \"voice.example.com\""; then
    fail "voice ingress default host" "expected host: \"voice.example.com\" derived from voice.publicBaseUrl with no voice.ingress.host set, got: $(printf '%s' "$ing" | grep host:)"
    return
  fi
  if ! printf '%s' "$ing" | grep -q "path: /twilio"; then
    fail "voice ingress path" "expected path: /twilio"
    return
  fi
  echo "ok   [voice ingress default host] Ingress host defaults to voice.example.com with no voice.ingress.host set"
}

# @scenario "The voice worker gets its own public hostname for Twilio to call"
test_ingress_host_explicit_override_renders() {
  local ing
  ing=$(render_component "ingress.yaml" \
    "$ENABLED_FLAGS --set voice.ingress.host=voice.example.com")
  if [ -z "$ing" ]; then
    fail "voice ingress explicit host" "rendered no voice Ingress with voice.ingress.host set explicitly"
    return
  fi
  if ! printf '%s' "$ing" | grep -q "host: \"voice.example.com\""; then
    fail "voice ingress explicit host" "expected host: \"voice.example.com\""
    return
  fi
  echo "ok   [voice ingress explicit host] explicit voice.ingress.host matching voice.publicBaseUrl renders"
}

# @scenario "The voice worker's ingress carries WebSocket-safe timeout annotations by default"
test_ingress_default_annotations_extend_websocket_timeout() {
  local ing
  ing=$(render_component "ingress.yaml" "$ENABLED_FLAGS")
  if [ -z "$ing" ]; then
    fail "voice ingress default annotations" "rendered no voice Ingress with voice.publicBaseUrl set"
    return
  fi
  if ! printf '%s' "$ing" | grep -q 'nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"'; then
    fail "voice ingress default annotations" "expected nginx.ingress.kubernetes.io/proxy-read-timeout: \"3600\" by default"
    return
  fi
  if ! printf '%s' "$ing" | grep -q 'nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"'; then
    fail "voice ingress default annotations" "expected nginx.ingress.kubernetes.io/proxy-send-timeout: \"3600\" by default"
    return
  fi
  echo "ok   [voice ingress default annotations] nginx proxy-read/send-timeout default to 3600s"
}

# @scenario "The voice worker refuses to expose a hostname that doesn't match its own public address"
test_ingress_host_mismatch_refuses() {
  local out
  if out=$(render "$ENABLED_FLAGS --set voice.ingress.host=other.example.com"); then
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

# @scenario "The voice worker does not render when only an http:// URL is available"
test_stock_app_http_public_url_renders_nothing() {
  local out
  if ! out=$(render "--set voice.enabled=true"); then
    fail "http-only app.http.publicUrl" "chart failed to render at all: $(printf '%s' "$out" | tail -5)"
    return
  fi
  if printf '%s' "$out" | grep -q "templates/voice/"; then
    fail "http-only app.http.publicUrl" "voice.enabled=true with the default http:// app.http.publicUrl and no voice.publicBaseUrl still rendered voice resources"
    return
  fi
  echo "ok   [http-only app.http.publicUrl] no https:// origin resolvable anywhere, voice.enabled=true still renders nothing (no failure either)"
}

# @scenario "Renders by default when an https:// public URL is configured (via app.http.publicUrl)"
test_app_http_public_url_https_renders_by_default() {
  local block
  block=$(render_component "deployment.yaml" "--set app.http.publicUrl=https://app.langwatch.ai")
  if [ -z "$block" ]; then
    fail "app.http.publicUrl fallback" "rendered no voice Deployment with app.http.publicUrl=https://app.langwatch.ai and voice.enabled left at its default (true), no voice.publicBaseUrl set"
    return
  fi
  if ! printf '%s' "$block" | grep -A1 "name: VOICE_PUBLIC_BASE_URL" | grep -q 'value: "https://app.langwatch.ai"'; then
    fail "app.http.publicUrl fallback" "expected VOICE_PUBLIC_BASE_URL=https://app.langwatch.ai resolved from app.http.publicUrl"
    return
  fi
  echo "ok   [app.http.publicUrl fallback] voice renders by default off app.http.publicUrl alone, zero voice.* values set"
}

# @scenario "An explicit voice.publicBaseUrl wins over app.http.publicUrl"
test_explicit_public_base_url_wins_over_app_http_public_url() {
  local block
  block=$(render_component "deployment.yaml" \
    "--set app.http.publicUrl=https://app.langwatch.ai --set voice.publicBaseUrl=https://voice.langwatch.ai")
  if [ -z "$block" ]; then
    fail "explicit wins" "rendered no voice Deployment"
    return
  fi
  if ! printf '%s' "$block" | grep -A1 "name: VOICE_PUBLIC_BASE_URL" | grep -q 'value: "https://voice.langwatch.ai"'; then
    fail "explicit wins" "expected the explicit voice.publicBaseUrl (https://voice.langwatch.ai) to win over app.http.publicUrl (https://app.langwatch.ai)"
    return
  fi
  echo "ok   [explicit wins] voice.publicBaseUrl overrides app.http.publicUrl when both are set"
}

# @scenario "voice.enabled=false still opts out even when a public https:// URL is available"
test_explicit_disabled_overrides_https_app_public_url() {
  local out
  if ! out=$(render "--set app.http.publicUrl=https://app.langwatch.ai --set voice.enabled=false"); then
    fail "explicit disabled" "chart failed to render at all: $(printf '%s' "$out" | tail -5)"
    return
  fi
  if printf '%s' "$out" | grep -q "templates/voice/"; then
    fail "explicit disabled" "voice.enabled=false rendered voice resources even with an https:// app.http.publicUrl"
    return
  fi
  echo "ok   [explicit disabled] voice.enabled=false opts out even with a resolvable https:// URL"
}

# @scenario "An explicit bad public address still fails the render"
test_explicit_bad_public_base_url_refuses_even_with_https_app_url() {
  local out
  if out=$(render "--set app.http.publicUrl=https://app.langwatch.ai --set voice.publicBaseUrl=http://voice.example.com"); then
    fail "explicit bad value" "chart rendered with an invalid voice.publicBaseUrl even though app.http.publicUrl was a valid https:// origin"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [explicit bad value] refused with the expected message even though app.http.publicUrl alone would have resolved" ;;
    *)
      fail "explicit bad value" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The voice worker refuses a public address that is not a valid https:// origin"
test_enabled_with_http_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.publicBaseUrl=http://voice.example.com"); then
    fail "http publicBaseUrl" "chart rendered when voice.publicBaseUrl used http:// instead of https://"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [http publicBaseUrl] refused with the expected message" ;;
    *)
      fail "http publicBaseUrl" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "Turning on the voice worker with a valid https:// public address renders"
test_enabled_with_https_public_base_url_renders() {
  local block
  block=$(render_component "deployment.yaml" "--set voice.publicBaseUrl=https://voice.example.com")
  if [ -z "$block" ]; then
    fail "https publicBaseUrl" "rendered no voice Deployment with a valid https:// voice.publicBaseUrl"
    return
  fi
  if ! printf '%s' "$block" | grep -A1 "name: VOICE_PUBLIC_BASE_URL" | grep -q 'value: "https://voice.example.com"'; then
    fail "https publicBaseUrl" "expected VOICE_PUBLIC_BASE_URL=https://voice.example.com"
    return
  fi
  echo "ok   [https publicBaseUrl] renders with VOICE_PUBLIC_BASE_URL=https://voice.example.com"
}

# @scenario "Turning on the voice worker with a valid https:// public address including a port renders"
test_enabled_with_https_port_public_base_url_renders() {
  local block
  block=$(render_component "deployment.yaml" "--set voice.publicBaseUrl=https://voice.example.com:8443")
  if [ -z "$block" ]; then
    fail "https publicBaseUrl with port" "rendered no voice Deployment with a valid https:// voice.publicBaseUrl including a port"
    return
  fi
  if ! printf '%s' "$block" | grep -A1 "name: VOICE_PUBLIC_BASE_URL" | grep -q 'value: "https://voice.example.com:8443"'; then
    fail "https publicBaseUrl with port" "expected VOICE_PUBLIC_BASE_URL=https://voice.example.com:8443"
    return
  fi
  echo "ok   [https publicBaseUrl with port] renders with VOICE_PUBLIC_BASE_URL=https://voice.example.com:8443"
}

# @scenario "The voice worker refuses a public address whose port is out of range"
test_enabled_with_out_of_range_port_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.publicBaseUrl=https://voice.example.com:65536"); then
    fail "out-of-range port publicBaseUrl" "chart rendered when voice.publicBaseUrl used port 65536"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [out-of-range port publicBaseUrl] refused with the expected message for port 65536" ;;
    *)
      fail "out-of-range port publicBaseUrl" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac

  if out=$(render "--set voice.publicBaseUrl=https://voice.example.com:0"); then
    fail "out-of-range port publicBaseUrl" "chart rendered when voice.publicBaseUrl used port 0"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [out-of-range port publicBaseUrl] refused with the expected message for port 0" ;;
    *)
      fail "out-of-range port publicBaseUrl" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The voice worker refuses a public address that includes a path"
test_enabled_with_path_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.publicBaseUrl=https://voice.example.com/twilio"); then
    fail "publicBaseUrl with path" "chart rendered when voice.publicBaseUrl included a path"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [publicBaseUrl with path] refused with the expected message" ;;
    *)
      fail "publicBaseUrl with path" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The voice worker refuses a public address that includes a query string"
test_enabled_with_query_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.publicBaseUrl=https://voice.example.com?x=1"); then
    fail "publicBaseUrl with query" "chart rendered when voice.publicBaseUrl included a query string"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [publicBaseUrl with query] refused with the expected message" ;;
    *)
      fail "publicBaseUrl with query" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The voice worker refuses a public address with a trailing slash"
test_enabled_with_trailing_slash_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.publicBaseUrl=https://voice.example.com/"); then
    fail "publicBaseUrl with trailing slash" "chart rendered when voice.publicBaseUrl had a trailing slash"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [publicBaseUrl with trailing slash] refused with the expected message" ;;
    *)
      fail "publicBaseUrl with trailing slash" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

# @scenario "The voice worker refuses a public address with a malformed hostname"
test_enabled_with_malformed_host_public_base_url_refuses() {
  local out
  if out=$(render "--set voice.publicBaseUrl=https://"); then
    fail "publicBaseUrl with no hostname" "chart rendered when voice.publicBaseUrl had no hostname"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [publicBaseUrl with no hostname] refused with the expected message" ;;
    *)
      fail "publicBaseUrl with no hostname" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
  if out=$(render "--set voice.publicBaseUrl=https://-bad.example.com"); then
    fail "publicBaseUrl with leading-hyphen hostname" "chart rendered when voice.publicBaseUrl's hostname started with a hyphen"
    return
  fi
  case "$out" in
    *"must be an https origin only"*)
      echo "ok   [publicBaseUrl with leading-hyphen hostname] refused with the expected message" ;;
    *)
      fail "publicBaseUrl with leading-hyphen hostname" "refused, but not for the expected reason: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

test_default_has_no_voice_resources
test_enabled_renders_deployment
test_termination_grace_period_follows_voice_values
test_enabled_renders_service_and_ingress_by_default
test_ingress_host_defaults_to_public_base_url_hostname
test_ingress_host_explicit_override_renders
test_ingress_default_annotations_extend_websocket_timeout
test_ingress_host_mismatch_refuses
test_stock_app_http_public_url_renders_nothing
test_app_http_public_url_https_renders_by_default
test_explicit_public_base_url_wins_over_app_http_public_url
test_explicit_disabled_overrides_https_app_public_url
test_explicit_bad_public_base_url_refuses_even_with_https_app_url
test_enabled_with_http_public_base_url_refuses
test_enabled_with_https_public_base_url_renders
test_enabled_with_https_port_public_base_url_renders
test_enabled_with_out_of_range_port_public_base_url_refuses
test_enabled_with_path_public_base_url_refuses
test_enabled_with_query_public_base_url_refuses
test_enabled_with_trailing_slash_public_base_url_refuses
test_enabled_with_malformed_host_public_base_url_refuses

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all voice-worker assertions passed"
