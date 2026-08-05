#!/usr/bin/env bash
#
# Renders the chart and asserts what the app container actually receives for
# each SSO provider.
#
# This executes the template pipeline rather than reading it, because the
# failure this guards against is invisible in the values file: a provider can
# be documented in the README, accepted in values.yaml and validated in
# _helpers.tpl while the Deployment never emits its environment variables at
# all. From the operator's side that is indistinguishable from the provider
# not being supported, and the only thing that tells them apart is rendering
# the chart and looking at the container.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies. The next
# line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/sso-providers.sh

set -euo pipefail

cd "$(dirname "$0")/.."

readonly BASE="--set autogen.enabled=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Every SSO-related env name in the app Deployment, sorted, one per line.
# A failed render yields no names rather than killing the run under `set -e`,
# so a chart that stops rendering is reported as the assertion it broke.
sso_env_of() {
  local flags="$1"
  # shellcheck disable=SC2086
  { helm template lw . $flags 2>/dev/null || true; } | awk '
    $0 ~ "^# Source: langwatch/templates/app/deployment.yaml" { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab && /- name: (NEXTAUTH_PROVIDER|AUTH0_|AZURE_AD_|COGNITO_|GITHUB_CLIENT|GITLAB_|GOOGLE_|OKTA_|ONELOGIN_)/ {
      gsub(/^[ -]*name: /, ""); print
    }
  ' | sort -u
}

# The value of one env var in the app Deployment.
env_value_of() {
  local flags="$1" name="$2"
  # shellcheck disable=SC2086
  { helm template lw . $flags 2>/dev/null || true; } | awk -v want="$name" '
    $0 ~ "^# Source: langwatch/templates/app/deployment.yaml" { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab && $0 ~ "- name: " want "$" { found=1; next }
    found && /value:/ {
      sub(/^[ ]*value: /, ""); gsub(/"/, ""); print; exit
    }
    found && /- name: / { exit }
  '
}

# The secret name a given env var reads from, empty if it is an inline value.
env_secret_of() {
  local flags="$1" name="$2"
  # shellcheck disable=SC2086
  { helm template lw . $flags 2>/dev/null || true; } | awk -v want="$name" '
    $0 ~ "^# Source: langwatch/templates/app/deployment.yaml" { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab && $0 ~ "- name: " want "$" { found=1; next }
    found && /secretKeyRef/ { inref=1; next }
    inref && /name:/ { sub(/^[ ]*name: /, ""); gsub(/"/, ""); print; exit }
    found && /- name: / { exit }
  '
}

flags_for() {
  local provider="$1"
  echo "$BASE \
    --set app.nextAuth.provider=$provider \
    --set app.nextAuth.providers.$provider.clientId.value=id-$provider \
    --set app.nextAuth.providers.$provider.clientSecret.value=secret-$provider \
    --set app.nextAuth.providers.$provider.issuer.value=https://issuer.$provider.test"
}

# @scenario "Configuring a provider through the chart reaches the container"
test_provider_env_reaches_the_container() {
  local provider prefix flags actual
  for provider in cognito onelogin; do
    prefix=$(echo "$provider" | tr '[:lower:]' '[:upper:]')
    flags=$(flags_for "$provider")
    actual=$(sso_env_of "$flags")

    local expected
    expected=$(printf '%s\n' \
      "NEXTAUTH_PROVIDER" \
      "${prefix}_CLIENT_ID" \
      "${prefix}_CLIENT_SECRET" \
      "${prefix}_ISSUER" | sort -u)

    if [[ "$actual" != "$expected" ]]; then
      fail "$provider env" \
        "expected exactly:
$expected
got:
$actual"
    fi

    local selected
    selected=$(env_value_of "$flags" NEXTAUTH_PROVIDER)
    if [[ "$selected" != "$provider" ]]; then
      fail "$provider selection" "NEXTAUTH_PROVIDER is '$selected', expected '$provider'"
    fi

    local issuer
    issuer=$(env_value_of "$flags" "${prefix}_ISSUER")
    if [[ "$issuer" != "https://issuer.$provider.test" ]]; then
      fail "$provider issuer" "${prefix}_ISSUER is '$issuer'"
    fi
  done
}

# @scenario "Credentials can be supplied as secret references"
test_client_secret_can_come_from_a_secret_reference() {
  local flags secret
  flags="$BASE \
    --set app.nextAuth.provider=cognito \
    --set app.nextAuth.providers.cognito.clientId.value=id-cognito \
    --set app.nextAuth.providers.cognito.clientSecret.secretKeyRef.name=langwatch-sso \
    --set app.nextAuth.providers.cognito.clientSecret.secretKeyRef.key=cognitoClientSecret \
    --set app.nextAuth.providers.cognito.issuer.value=https://issuer.cognito.test"

  secret=$(env_secret_of "$flags" COGNITO_CLIENT_SECRET)
  if [[ "$secret" != "langwatch-sso" ]]; then
    fail "cognito secretKeyRef" \
      "COGNITO_CLIENT_SECRET reads from '$secret', expected 'langwatch-sso'"
  fi
}

# A provider left at its defaults must contribute nothing, or an operator who
# configured one identity provider would ship empty credentials for six others.
test_unconfigured_providers_emit_nothing() {
  local actual
  actual=$(sso_env_of "$BASE")
  if [[ "$actual" != "NEXTAUTH_PROVIDER" ]]; then
    fail "default render" \
      "expected only NEXTAUTH_PROVIDER with no provider configured, got:
$actual"
  fi
}

test_provider_env_reaches_the_container
test_client_secret_can_come_from_a_secret_reference
test_unconfigured_providers_emit_nothing

if ((failures > 0)); then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "All SSO provider chart assertions passed"
