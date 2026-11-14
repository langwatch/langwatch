#!/usr/bin/env bash
#
# Renders the chart and pins the app writer's wiring (ADR-202 Decided 12). The writer
# is off by default this release, so an install that sets no writer value renders
# exactly as before. Turned on beside the reader, a hook Secret holds its password and
# URL before the access-render Job runs, and the app, the workers and that Job read the
# URL from it. Turned on without the reader, the chart refuses to render.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/app-writer-env.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
WORKLOADS=("app/deployment.yaml" "workers/deployment.yaml" "clickhouse/lwql-access-render.yaml")

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

# One data key of the app writer Secret, decoded.
writer_secret_value() {
  local render="$1" key="$2"
  awk -v k="$key" '
    /^# Source:/ { insrc = (index($0, "clickhouse/app-writer-secret.yaml") > 0) }
    insrc && $0 ~ "^  " k ":" { sub("^  " k ":[[:space:]]*", ""); gsub(/"/, ""); print; exit }
  ' "$render" | base64 --decode
}

# @scenario "A chart install that sets no writer value renders as before"
test_default_renders_as_before() {
  local out="${TMPDIR:-/tmp}/app-writer-default.yaml" err="${TMPDIR:-/tmp}/app-writer-default.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true; then
    fail "default-render" "render with the reader on and the writer unset failed: $(cat "$err")"
    return
  fi
  local workload names
  for workload in "${WORKLOADS[@]}"; do
    names="$(env_names_in "$out" "$workload")"
    [[ -n "$names" ]] || fail "default-empty-$workload" "no env found for $workload; did the Source path change?"
    if has_env "$names" CLICKHOUSE_WRITER_URL; then
      fail "default-$workload" "$workload emits CLICKHOUSE_WRITER_URL with clickhouse.appWriter.enabled unset."
    fi
  done
  if grep -q "clickhouse/app-writer-secret.yaml" "$out"; then
    fail "default-secret" "the app writer Secret renders with clickhouse.appWriter.enabled unset."
  fi
}

# @scenario "The chart provisions and wires the app writer when it is enabled"
test_enabled_wires_writer() {
  local out="${TMPDIR:-/tmp}/app-writer-on.yaml" err="${TMPDIR:-/tmp}/app-writer-on.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set clickhouse.appWriter.enabled=true; then
    fail "on-render" "render with the reader and the writer on failed: $(cat "$err")"
    return
  fi
  local workload
  for workload in "${WORKLOADS[@]}"; do
    if [[ "$(secret_ref_of "$out" "$workload" CLICKHOUSE_WRITER_URL)" != "t-clickhouse-app-writer/CLICKHOUSE_WRITER_URL" ]]; then
      fail "on-ref-$workload" "$workload does not read CLICKHOUSE_WRITER_URL from the t-clickhouse-app-writer Secret."
    fi
    [[ "$(secret_ref_of "$out" "$workload" CLICKHOUSE_READER_URL)" == "t-clickhouse-app-reader/CLICKHOUSE_READER_URL" ]] ||
      fail "on-reader-$workload" "$workload lost CLICKHOUSE_READER_URL when the writer was turned on."
  done
  local hook
  hook="$(awk '/^# Source:/ { s = (index($0, "clickhouse/app-writer-secret.yaml") > 0) } s && /helm.sh\/hook(-weight)?:/' "$out" | tr -s ' ')"
  if [[ "$hook" != *"helm.sh/hook: pre-install,pre-upgrade,pre-rollback"* || "$hook" != *'helm.sh/hook-weight: "-10"'* ]]; then
    fail "on-hook" "the app writer Secret is not a pre-install,pre-upgrade,pre-rollback hook at weight -10, so the render Job could run before it."
  fi
  local url
  url="$(writer_secret_value "$out" CLICKHOUSE_WRITER_URL)"
  if [[ ! "$url" =~ ^http://langwatch_app_writer:[0-9a-f]{64}@t-clickhouse:8123/langwatch$ ]]; then
    fail "on-url" "the Secret's CLICKHOUSE_WRITER_URL is not langwatch_app_writer's on the chart's ClickHouse service."
  fi
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set clickhouse.appWriter.enabled=true --set lwql.enabled=false; then
    fail "on-no-lwql-render" "render with the writer on and LangWatchQL off failed: $(cat "$err")"
    return
  fi
  [[ "$(secret_ref_of "$out" "clickhouse/lwql-access-render.yaml" CLICKHOUSE_WRITER_URL)" == "t-clickhouse-app-writer/CLICKHOUSE_WRITER_URL" ]] ||
    fail "on-no-lwql-ref" "with LangWatchQL off the render Job does not read CLICKHOUSE_WRITER_URL, so it cannot deliver the writer."
}

# @scenario "The chart refuses the app writer without the app reader"
test_writer_needs_reader() {
  local out="${TMPDIR:-/tmp}/app-writer-alone.yaml" err="${TMPDIR:-/tmp}/app-writer-alone.err"
  if render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appWriter.enabled=true; then
    fail "alone-render" "the chart rendered clickhouse.appWriter.enabled without clickhouse.appReader.enabled."
    return
  fi
  grep -qF "clickhouse.appWriter.enabled needs clickhouse.appReader.enabled" "$err" ||
    fail "alone-message" "the refusal does not name clickhouse.appReader.enabled: $(cat "$err")"
}

# @scenario "The chart provisions and wires the app writer when it is enabled"
test_existing_secret_carries_writer() {
  local out="${TMPDIR:-/tmp}/app-writer-existing.yaml" err="${TMPDIR:-/tmp}/app-writer-existing.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set secrets.existingSecret=ops-secret \
    --set gateway.secrets.existingSecretName=ops-secret --set langyagent.secrets.existingSecretName=ops-secret \
    --set clickhouse.appReader.enabled=true --set clickhouse.appWriter.enabled=true; then
    fail "existing-render" "render with secrets.existingSecret failed: $(cat "$err")"
    return
  fi
  grep -q "clickhouse/app-writer-secret.yaml" "$out" &&
    fail "existing-secret" "the chart generated a writer Secret although secrets.existingSecret is set."
  [[ "$(secret_ref_of "$out" "app/deployment.yaml" CLICKHOUSE_WRITER_URL)" == "ops-secret/CLICKHOUSE_WRITER_URL" ]] ||
    fail "existing-ref" "the app does not read CLICKHOUSE_WRITER_URL from secrets.existingSecret."
}

test_default_renders_as_before
test_enabled_wires_writer
test_writer_needs_reader
test_existing_secret_carries_writer

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: the app writer is off by default and renders as before; enabled beside the reader, a pre-install/pre-upgrade hook Secret holds its URL for the app, the workers and the render Job, with LangWatchQL on or off; enabled without the reader the chart refuses to render; an operator Secret is read instead of generated"
