#!/usr/bin/env bash
#
# Renders the chart and asserts what Connect emits, on both postures.
#
# The upgrade guarantee for ADR-139 is a claim about absence: an install that
# upgrades and changes no value must carry no LANGWATCH_CONNECT_ variable at
# all, so nothing in the app can decide to call LangWatch. Absence is exactly
# what a template's source does not show: an `{{- if }}` that is wrong emits
# the block anyway and nothing in the chart complains, so it is pinned on the
# render.
#
# The second posture is the operator who does switch it on. Then the app AND
# the workers have to agree: the workers judge too, and an app that can reach
# hosted services beside a worker that cannot makes the same query behave
# differently depending on which one ran it.
#
# Each test carries a plain "# Verifies:" line naming what it pins.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/connect-env.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Render the chart, tolerating a non-zero exit so a render failure becomes an
# assertion outcome with context rather than a bare `set -e` abort.
render_to() {
  local out="$1" err="$2" release="$3"
  shift 3
  local status
  # shellcheck disable=SC2086
  helm template "$release" . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# All env var names emitted inside ONE deployment's Source block. $2 is the
# template path fragment identifying the workload.
env_names_in() {
  local render="$1" src="$2"
  awk -v want="$src" '
    /^# Source:/ { insrc = (index($0, want) > 0) }
    insrc && /^[[:space:]]*- name:[[:space:]]/ {
      sub(/^[[:space:]]*- name:[[:space:]]*/, ""); print
    }
  ' "$render"
}

# True if $names (newline-separated) contains exactly $2.
has_env() {
  printf '%s\n' "$1" | grep -qxF "$2"
}

# The literal value emitted for `- name: <var>` anywhere in the render.
env_value_of() {
  local render="$1" var="$2"
  awk -v want="$var" '
    $0 ~ "- name: " want "$" { getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit }
  ' "$render"
}

WORKLOADS=("app/deployment.yaml" "workers/deployment.yaml")

# Verifies: a default install emits no LANGWATCH_CONNECT_ variable at all
test_default_emits_nothing() {
  local out="${TMPDIR:-/tmp}/connect-default.yaml"
  local err="${TMPDIR:-/tmp}/connect-default.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "default-render" "default render failed:
$(cat "$err")"
    return
  fi

  local found
  found="$(grep -c 'LANGWATCH_CONNECT_' "$out" || true)"
  if [[ "$found" != "0" ]]; then
    fail "default-emits-connect" \
      "a default render carries $found LANGWATCH_CONNECT_ line(s). An install that upgrades and changes no value must call no hosted service, and the app reads these variables to decide whether it may."
  fi
}

# Verifies: switching Connect on emits the flag on app AND workers, and no
# endpoint the operator did not name
test_enabled_emits_the_flag_only() {
  local out="${TMPDIR:-/tmp}/connect-on.yaml"
  local err="${TMPDIR:-/tmp}/connect-on.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set app.connect.enabled=true; then
    fail "enabled-render" "render with Connect on failed:
$(cat "$err")"
    return
  fi

  local workload names
  for workload in "${WORKLOADS[@]}"; do
    names="$(env_names_in "$out" "$workload")"
    if [[ -z "$names" ]]; then
      fail "enabled-empty-$workload" \
        "no env vars found for $workload, did the Source path change?"
      continue
    fi
    if ! has_env "$names" "LANGWATCH_CONNECT_ENABLED"; then
      fail "enabled-missing-$workload" \
        "$workload does not emit LANGWATCH_CONNECT_ENABLED. The workers judge eval functions too; a worker that cannot reach hosted services skips every judgement the app would have answered."
    fi
    local named
    for named in LANGWATCH_CONNECT_GATEWAY_ENDPOINT \
                 LANGWATCH_CONNECT_LICENSE_ENDPOINT \
                 LANGWATCH_CONNECT_INSTANCE_ID; do
      if has_env "$names" "$named"; then
        fail "enabled-extra-$workload-$named" \
          "$workload emits $named although the operator named no value. An empty value there is not the published default; it is an empty string the app would have to defend against."
      fi
    done
  done

  local flag
  flag="$(env_value_of "$out" "LANGWATCH_CONNECT_ENABLED")"
  if [[ "$flag" != "true" ]]; then
    fail "enabled-value" \
      "LANGWATCH_CONNECT_ENABLED is '${flag:-<empty>}', expected 'true'."
  fi
}

# Verifies: endpoints and the instance id the operator names are carried through
test_named_endpoints_are_carried() {
  local out="${TMPDIR:-/tmp}/connect-endpoints.yaml"
  local err="${TMPDIR:-/tmp}/connect-endpoints.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set app.connect.enabled=true \
      --set app.connect.gatewayEndpoint=https://gateway.example.test \
      --set app.connect.licenseEndpoint=https://connect.example.test \
      --set app.connect.instanceId=instance-of-record; then
    fail "endpoints-render" "render with named endpoints failed:
$(cat "$err")"
    return
  fi

  local pair expected actual
  for pair in \
      "LANGWATCH_CONNECT_GATEWAY_ENDPOINT=https://gateway.example.test" \
      "LANGWATCH_CONNECT_LICENSE_ENDPOINT=https://connect.example.test" \
      "LANGWATCH_CONNECT_INSTANCE_ID=instance-of-record"; do
    expected="${pair#*=}"
    actual="$(env_value_of "$out" "${pair%%=*}")"
    if [[ "$actual" != "$expected" ]]; then
      fail "endpoints-${pair%%=*}" \
        "${pair%%=*} is '${actual:-<empty>}', expected '$expected'."
    fi
  done

  local workload names
  for workload in "${WORKLOADS[@]}"; do
    names="$(env_names_in "$out" "$workload")"
    if ! has_env "$names" "LANGWATCH_CONNECT_GATEWAY_ENDPOINT"; then
      fail "endpoints-missing-$workload" \
        "$workload does not emit LANGWATCH_CONNECT_GATEWAY_ENDPOINT, so it would call a different host than the other workload."
    fi
  done
}

# Verifies: endpoints named while Connect stays off emit nothing
test_endpoints_without_enabled_emit_nothing() {
  local out="${TMPDIR:-/tmp}/connect-off-endpoints.yaml"
  local err="${TMPDIR:-/tmp}/connect-off-endpoints.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set app.connect.gatewayEndpoint=https://gateway.example.test \
      --set app.connect.instanceId=instance-of-record; then
    fail "off-endpoints-render" "render failed:
$(cat "$err")"
    return
  fi

  if grep -q 'LANGWATCH_CONNECT_' "$out"; then
    fail "off-endpoints-emitted" \
      "naming an endpoint emitted LANGWATCH_CONNECT_ variables although app.connect.enabled is false. The switch is what decides, so a value left behind from an experiment must not turn hosted services back on."
  fi
}

test_default_emits_nothing
test_enabled_emits_the_flag_only
test_named_endpoints_are_carried
test_endpoints_without_enabled_emit_nothing

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: all 4 Connect postures pinned: (1) a default render carries no LANGWATCH_CONNECT_ variable; (2) switching Connect on emits the flag on app and workers and no endpoint the operator did not name; (3) named endpoints and instance id are carried to both workloads; (4) endpoints named while Connect stays off emit nothing"
