#!/usr/bin/env bash
#
# Renders the chart with the awsS3 dataplane provider and asserts that
# app.dataplane.providers.awsS3.region reaches every process as S3_REGION,
# and that no S3_REGION renders when it is unset
# (specs/features/scenarios/externalize-event-byte-content.feature).
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/s3-region.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render_to() {
  local out="$1" err="$2"
  shift 2
  helm template t . \
    --set autogen.enabled=true \
    --set app.dataplane.enabled=true \
    --set app.dataplane.provider=awsS3 \
    --set app.storedObjects.localFilesystem.enabled=false \
    --set app.dataplane.providers.awsS3.endpoint.value=https://storage.eu-north1.example \
    --set app.dataplane.providers.awsS3.accessKeyId.value=key-marker \
    --set app.dataplane.providers.awsS3.secretAccessKey.value=secret-marker \
    "$@" >"$out" 2>"$err"
}

# Every value emitted for `- name: <var>` in one rendered template, one per line.
env_values_of() {
  local render="$1" template="$2" var="$3"
  awk -v src="langwatch/templates/$template" -v want="$var" '
    /^# Source:/ { insrc = (index($0, src) > 0) }
    insrc && $0 ~ "- name: " want "$" { getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print }
  ' "$render"
}

# @scenario "Helm chart passes the awsS3 provider's region to every process"
test_region_reaches_every_process() {
  local out="${TMPDIR:-/tmp}/s3-region-set.yaml"
  local err="${TMPDIR:-/tmp}/s3-region-set.err"
  if ! render_to "$out" "$err" --set app.dataplane.providers.awsS3.region=eu-north1; then
    fail "set-render" "render failed:
$(cat "$err")"
    return
  fi

  local template got
  for template in app/deployment.yaml workers/deployment.yaml; do
    got="$(env_values_of "$out" "$template" S3_REGION)"
    if [[ "$got" != "eu-north1" ]]; then
      fail "set-$template" "S3_REGION values are '$(echo "$got" | paste -sd, -)', expected exactly 'eu-north1'."
    fi
  done

  # Every other container carrying the S3 settings (hooks, jobs) carries the region too.
  local buckets regions
  buckets="$(grep -c -- "- name: S3_BUCKET_NAME$" "$out" || true)"
  regions="$(grep -A1 -- "- name: S3_REGION$" "$out" | grep -c 'value: "eu-north1"' || true)"
  if [[ "$buckets" != "$regions" ]]; then
    fail "set-everywhere" "$buckets containers carry S3_BUCKET_NAME but $regions carry S3_REGION=eu-north1."
  fi
}

# @scenario "Helm chart passes the awsS3 provider's region to every process"
test_no_region_renders_no_variable() {
  local out="${TMPDIR:-/tmp}/s3-region-unset.yaml"
  local err="${TMPDIR:-/tmp}/s3-region-unset.err"
  if ! render_to "$out" "$err"; then
    fail "unset-render" "render failed:
$(cat "$err")"
    return
  fi

  if grep -q -- "- name: S3_REGION$" "$out"; then
    fail "unset" "S3_REGION rendered with no region set; the SDK region rule must decide."
  fi
}

test_region_reaches_every_process
test_no_region_renders_no_variable

if [[ "$failures" -gt 0 ]]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "s3-region: all checks passed"
