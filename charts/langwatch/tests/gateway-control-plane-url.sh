#!/usr/bin/env bash
#
# Renders the chart and asserts the app is told the control plane address the
# chart's gateway dials (GATEWAY_CONTROL_PLANE_URL), equal to the gateway
# ConfigMap's LW_GATEWAY_BASE_URL. The checkup compares the two.
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/gateway-control-plane-url.sh

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

# Plain `value:` of `- name: <var>` inside ONE workload's Source block.
env_value_in() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v v="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && /^[[:space:]]*- name:[[:space:]]/ && $0 !~ ("- name: " v "$") { found=0 }
    found && /^[[:space:]]*value:[[:space:]]/ {
      sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }
  ' "$render"
}

# The gateway ConfigMap's `LW_GATEWAY_BASE_URL: "<url>"` line.
gateway_dials() {
  awk '
    /^# Source:/ { insrc = (index($0, "gateway/templates/configmap.yaml") > 0) }
    insrc && /^[[:space:]]*LW_GATEWAY_BASE_URL:/ {
      sub(/^[[:space:]]*LW_GATEWAY_BASE_URL:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }
  ' "$1"
}

check_render() {
  local label="$1" want="$2"
  shift 2
  local out="${TMPDIR:-/tmp}/gw-cp-$label.yaml"
  local err="${TMPDIR:-/tmp}/gw-cp-$label.err"
  if ! render_to "$out" "$err" acme --set autogen.enabled=true "$@"; then
    fail "$label-render" "render failed:
$(cat "$err")"
    return
  fi
  local app dials
  app="$(env_value_in "$out" "app/deployment.yaml" "GATEWAY_CONTROL_PLANE_URL")"
  dials="$(gateway_dials "$out")"
  if [[ "$app" != "$want" ]]; then
    fail "$label-app" "app has GATEWAY_CONTROL_PLANE_URL=${app:-<unset>}, want $want."
  fi
  if [[ "$dials" != "$want" ]]; then
    fail "$label-gateway" "gateway dials ${dials:-<unset>}, want $want."
  fi
}

# @scenario "The chart tells the app the control plane address its gateway dials"
test_default_is_release_app_service() {
  check_render default "http://acme-app:5560"
}

# @scenario "The chart tells the app the control plane address its gateway dials"
test_control_plane_override() {
  check_render override "http://control.mesh.internal:6000" \
    --set gateway.controlPlane.baseUrl=http://control.mesh.internal:6000
}

test_default_is_release_app_service
test_control_plane_override

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: the app's GATEWAY_CONTROL_PLANE_URL matches the address the gateway dials, default and overridden"
