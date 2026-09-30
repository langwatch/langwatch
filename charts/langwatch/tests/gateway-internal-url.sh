#!/usr/bin/env bash
#
# Renders the chart and asserts the app and workers get the in-cluster gateway
# address as LW_GATEWAY_INTERNAL_URL (Langy and Codex models dial it; the
# public URL may not resolve from inside the cluster).
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/gateway-internal-url.sh

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

WORKLOADS=("app/deployment.yaml" "workers/deployment.yaml")

# @scenario "The chart hands the app and workers the in-cluster gateway address"
test_default_points_at_release_service() {
  local out="${TMPDIR:-/tmp}/gw-internal-default.yaml"
  local err="${TMPDIR:-/tmp}/gw-internal-default.err"
  if ! render_to "$out" "$err" acme --set autogen.enabled=true \
      --set gateway.publicUrl=http://localhost:18563; then
    fail "default-render" "default render failed:
$(cat "$err")"
    return
  fi
  local workload value
  for workload in "${WORKLOADS[@]}"; do
    value="$(env_value_in "$out" "$workload" "LW_GATEWAY_INTERNAL_URL")"
    if [[ "$value" != "http://acme-gateway:80" ]]; then
      fail "default-$workload" \
        "$workload has LW_GATEWAY_INTERNAL_URL=${value:-<unset>}, want http://acme-gateway:80 (the release's gateway Service), never gateway.publicUrl."
    fi
  done
}

# @scenario "The chart hands the app and workers the in-cluster gateway address"
test_internal_url_override() {
  local out="${TMPDIR:-/tmp}/gw-internal-override.yaml"
  local err="${TMPDIR:-/tmp}/gw-internal-override.err"
  if ! render_to "$out" "$err" acme --set autogen.enabled=true \
      --set gateway.internalUrl=http://gateway.mesh.internal:8080; then
    fail "override-render" "override render failed:
$(cat "$err")"
    return
  fi
  local workload value
  for workload in "${WORKLOADS[@]}"; do
    value="$(env_value_in "$out" "$workload" "LW_GATEWAY_INTERNAL_URL")"
    if [[ "$value" != "http://gateway.mesh.internal:8080" ]]; then
      fail "override-$workload" \
        "$workload has LW_GATEWAY_INTERNAL_URL=${value:-<unset>}, want the gateway.internalUrl value."
    fi
  done
}

test_default_points_at_release_service
test_internal_url_override

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: app and workers get LW_GATEWAY_INTERNAL_URL from the release's gateway Service, and gateway.internalUrl overrides it"
