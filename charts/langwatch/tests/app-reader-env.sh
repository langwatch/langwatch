#!/usr/bin/env bash
#
# Renders the chart and pins the app reader's wiring (ADR-202 slice 4). The reader
# is off by default this release, so an install that sets no reader value renders
# exactly as before. Turned on, a hook Secret holds its password and URL before the
# access-render Job runs, and the app, the workers and that Job read the URL from it.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/app-reader-env.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
WORKLOADS=("app/deployment.yaml" "workers/deployment.yaml" "clickhouse/lwql-access-render.yaml")
READER_VARS=(CLICKHOUSE_READER_URL CLICKHOUSE_ENFORCING_READER_URL CLICKHOUSE_SHADOW_SAMPLE_RATE CLICKHOUSE_TENANCY_ENFORCE)

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render_to() {
  local out="$1" err="$2"
  shift 2
  local status
  helm template t . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# The `- name: X` env keys inside one template's Source block.
env_names_in() {
  local render="$1" src="$2"
  awk -v want="$src" '
    /^# Source:/ { insrc = (index($0, want) > 0) }
    insrc && /^[[:space:]]*- name:[[:space:]]/ {
      sub(/^[[:space:]]*- name:[[:space:]]*/, ""); print
    }
  ' "$render"
}

has_env() {
  printf '%s\n' "$1" | grep -qxF "$2"
}

# The secretKeyRef name and key of `- name: <var>` in one Source block, as "name/key".
secret_ref_of() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v v="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && found && /^[[:space:]]*- name:[[:space:]]/ { found=0 }
    found && /^[[:space:]]*name:[[:space:]]/ { sub(/^[[:space:]]*name:[[:space:]]*/, ""); n=$0 }
    found && /^[[:space:]]*key:[[:space:]]/ { sub(/^[[:space:]]*key:[[:space:]]*/, ""); print n "/" $0; exit }
  ' "$render"
}

# The plain `value:` of `- name: <var>` in one Source block.
env_value_in() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v v="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && found && /^[[:space:]]*- name:[[:space:]]/ { found=0 }
    found && /^[[:space:]]*value:[[:space:]]/ {
      sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }
  ' "$render"
}

# One data key of the app reader Secret, decoded.
reader_secret_value() {
  local render="$1" key="$2"
  awk -v k="$key" '
    /^# Source:/ { insrc = (index($0, "clickhouse/app-reader-secret.yaml") > 0) }
    insrc && $0 ~ "^  " k ":" { sub("^  " k ":[[:space:]]*", ""); gsub(/"/, ""); print; exit }
  ' "$render" | base64 --decode
}

# @scenario "A chart install that sets no reader value renders as before"
test_default_renders_as_before() {
  local out="${TMPDIR:-/tmp}/app-reader-default.yaml" err="${TMPDIR:-/tmp}/app-reader-default.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true; then
    fail "default-render" "default render failed: $(cat "$err")"
    return
  fi
  local workload names var
  for workload in "${WORKLOADS[@]}"; do
    names="$(env_names_in "$out" "$workload")"
    [[ -n "$names" ]] || fail "default-empty-$workload" "no env found for $workload; did the Source path change?"
    for var in "${READER_VARS[@]}"; do
      if has_env "$names" "$var"; then
        fail "default-$workload-$var" "$workload emits $var with no reader value set; an install that sets none must render as before."
      fi
    done
  done
  if grep -q "clickhouse/app-reader-secret.yaml" "$out"; then
    fail "default-secret" "the app reader Secret renders with clickhouse.appReader.enabled unset."
  fi
}

# @scenario "The chart provisions and wires the app reader when it is enabled"
test_enabled_wires_reader() {
  local out="${TMPDIR:-/tmp}/app-reader-on.yaml" err="${TMPDIR:-/tmp}/app-reader-on.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true; then
    fail "on-render" "render with the reader on failed: $(cat "$err")"
    return
  fi
  local workload names
  for workload in "${WORKLOADS[@]}"; do
    names="$(env_names_in "$out" "$workload")"
    if [[ "$(secret_ref_of "$out" "$workload" CLICKHOUSE_READER_URL)" != "t-clickhouse-app-reader/CLICKHOUSE_READER_URL" ]]; then
      fail "on-ref-$workload" "$workload does not read CLICKHOUSE_READER_URL from the t-clickhouse-app-reader Secret."
    fi
    for var in CLICKHOUSE_ENFORCING_READER_URL CLICKHOUSE_SHADOW_SAMPLE_RATE CLICKHOUSE_TENANCY_ENFORCE; do
      if has_env "$names" "$var"; then
        fail "on-$workload-$var" "$workload emits $var with only clickhouse.appReader.enabled set."
      fi
    done
  done
  local hook
  hook="$(awk '/^# Source:/ { s = (index($0, "clickhouse/app-reader-secret.yaml") > 0) } s && /helm.sh\/hook(-weight)?:/' "$out" | tr -s ' ')"
  if [[ "$hook" != *"helm.sh/hook: pre-install,pre-upgrade,pre-rollback"* || "$hook" != *'helm.sh/hook-weight: "-10"'* ]]; then
    fail "on-hook" "the app reader Secret is not a pre-install,pre-upgrade,pre-rollback hook at weight -10, so the render Job could run before it."
  fi
  local url
  url="$(reader_secret_value "$out" CLICKHOUSE_READER_URL)"
  if [[ ! "$url" =~ ^http://langwatch_app_reader:[0-9a-f]{64}@t-clickhouse:8123/langwatch$ ]]; then
    fail "on-url" "the Secret's CLICKHOUSE_READER_URL is not langwatch_app_reader's on the chart's ClickHouse service."
  fi
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true --set lwql.enabled=false; then
    grep -q "clickhouse.appReader.enabled=true needs lwql.enabled=true" "$err" ||
      fail "on-no-lwql-reason" "the render with LangWatchQL off failed without naming lwql.enabled."
  else
    fail "on-no-lwql" "the reader rendered with lwql.enabled=false, whose render Job would not deliver it."
  fi
}

# @scenario "The chart provisions and wires the app reader when it is enabled"
test_sampling_and_enforce() {
  local out="${TMPDIR:-/tmp}/app-reader-sampled.yaml" err="${TMPDIR:-/tmp}/app-reader-sampled.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set-string clickhouse.appReader.shadowSampleRate=0.05 --set clickhouse.appReader.enforce=true; then
    fail "sampled-render" "render with sampling and enforce failed: $(cat "$err")"
    return
  fi
  local workload
  for workload in "${WORKLOADS[@]}"; do
    if [[ "$(secret_ref_of "$out" "$workload" CLICKHOUSE_ENFORCING_READER_URL)" != "t-clickhouse-app-reader/CLICKHOUSE_ENFORCING_READER_URL" ]]; then
      fail "sampled-ref-$workload" "$workload does not read CLICKHOUSE_ENFORCING_READER_URL from the reader Secret."
    fi
    [[ "$(env_value_in "$out" "$workload" CLICKHOUSE_SHADOW_SAMPLE_RATE)" == "0.05" ]] ||
      fail "sampled-rate-$workload" "$workload does not carry CLICKHOUSE_SHADOW_SAMPLE_RATE=0.05."
    [[ "$(env_value_in "$out" "$workload" CLICKHOUSE_TENANCY_ENFORCE)" == "true" ]] ||
      fail "enforce-$workload" "$workload does not carry CLICKHOUSE_TENANCY_ENFORCE=true."
  done
  local url
  url="$(reader_secret_value "$out" CLICKHOUSE_ENFORCING_READER_URL)"
  if [[ ! "$url" =~ ^http://langwatch_app_reader_enforcing:[0-9a-f]{64}@t-clickhouse:8123/langwatch$ ]]; then
    fail "sampled-url" "the Secret's CLICKHOUSE_ENFORCING_READER_URL is not langwatch_app_reader_enforcing's."
  fi
}

# With an operator Secret the chart generates nothing and reads the URL from that Secret.
test_existing_secret_carries_reader() {
  local out="${TMPDIR:-/tmp}/app-reader-existing.yaml" err="${TMPDIR:-/tmp}/app-reader-existing.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set secrets.existingSecret=ops-secret \
    --set gateway.secrets.existingSecretName=ops-secret --set langyagent.secrets.existingSecretName=ops-secret \
    --set clickhouse.appReader.enabled=true; then
    fail "existing-render" "render with secrets.existingSecret failed: $(cat "$err")"
    return
  fi
  grep -q "clickhouse/app-reader-secret.yaml" "$out" &&
    fail "existing-secret" "the chart generated a reader Secret although secrets.existingSecret is set."
  [[ "$(secret_ref_of "$out" "app/deployment.yaml" CLICKHOUSE_READER_URL)" == "ops-secret/CLICKHOUSE_READER_URL" ]] ||
    fail "existing-ref" "the app does not read CLICKHOUSE_READER_URL from secrets.existingSecret."
}

test_default_renders_as_before
test_enabled_wires_reader
test_sampling_and_enforce
test_existing_secret_carries_reader

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: the app reader is off by default and renders as before; enabled, a pre-install/pre-upgrade hook Secret holds its URL for the app, the workers and the render Job; sampling adds the enforcing URL and rate; enforce sets CLICKHOUSE_TENANCY_ENFORCE; an operator Secret is read instead of generated"
