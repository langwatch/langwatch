#!/usr/bin/env bash
#
# Renders the chart and asserts the self sign-up settings reach the app
# (specs/auth/sign-up-restriction.feature).
#
# A default install must render neither variable, so an upgrade that changes
# no value leaves sign-up exactly as it was.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/sign-up-env.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render_to() {
  local out="$1" err="$2" release="$3"
  shift 3
  local status
  helm template "$release" . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# The literal value emitted for `- name: <var>` inside the app Deployment.
app_env_value_of() {
  local render="$1" var="$2"
  awk -v want="$var" '
    /^# Source:/ { insrc = (index($0, "app/deployment.yaml") > 0) }
    insrc && $0 ~ "- name: " want "$" { getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit }
  ' "$render"
}

# Verifies: a default install renders no sign-up variable
test_default_renders_nothing() {
  local out="${TMPDIR:-/tmp}/sign-up-default.yaml"
  local err="${TMPDIR:-/tmp}/sign-up-default.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "default-render" "default render failed:
$(cat "$err")"
    return
  fi
  local found
  found="$(grep -c 'SIGN_UP_' "$out" || true)"
  if [[ "$found" != "0" ]]; then
    fail "default-emits-sign-up" \
      "a default render carries $found SIGN_UP_ line(s); an upgrade that changes no value must keep sign-up as it was."
  fi
}

# @scenario "The Helm chart renders the sign-up settings"
# Verifies: invite-only mode and the allowed domains reach the app
test_sign_up_settings_reach_the_app() {
  local out="${TMPDIR:-/tmp}/sign-up-set.yaml"
  local err="${TMPDIR:-/tmp}/sign-up-set.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set app.signUp.mode=invite_only \
      --set 'app.signUp.allowedDomains[0]=acme.com' \
      --set 'app.signUp.allowedDomains[1]=acme.io'; then
    fail "set-render" "render with sign-up settings failed:
$(cat "$err")"
    return
  fi

  local mode domains
  mode="$(app_env_value_of "$out" "SIGN_UP_MODE")"
  if [[ "$mode" != "invite_only" ]]; then
    fail "mode-value" "SIGN_UP_MODE is '${mode:-<empty>}', expected 'invite_only'."
  fi
  domains="$(app_env_value_of "$out" "SIGN_UP_ALLOWED_DOMAINS")"
  if [[ "$domains" != "acme.com,acme.io" ]]; then
    fail "domains-value" \
      "SIGN_UP_ALLOWED_DOMAINS is '${domains:-<empty>}', expected 'acme.com,acme.io'."
  fi
}

test_default_renders_nothing
test_sign_up_settings_reach_the_app

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi
echo "sign-up-env: all checks passed"
