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

# The secretKeyRef name and key of `- name: <var>` in one Source block, as "name/key", in
# either order: the api's env is re-rendered with sorted keys once the reader and writer are on.
secret_ref_of() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v v="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; n=""; k=""; next }
    insrc && found && /^[[:space:]]*- name:[[:space:]]/ { found=0 }
    found && /^[[:space:]]*name:[[:space:]]/ { sub(/^[[:space:]]*name:[[:space:]]*/, ""); n=$0 }
    found && /^[[:space:]]*key:[[:space:]]/ { sub(/^[[:space:]]*key:[[:space:]]*/, ""); k=$0 }
    found && n != "" && k != "" { print n "/" k; exit }
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

# How many `- name: <var>` entries one Source block holds, across its containers.
env_count_in() {
  env_names_in "$1" "$2" | grep -cxF "$3" || true
}

SYSTEM_ENV=(CLICKHOUSE_URL CLICKHOUSE_PASSWORD CLICKHOUSE_PASSWORD_FILE)

# @scenario "The chart gives the api no system credential once the reader and the writer are on"
test_api_drops_system_credential() {
  local out="${TMPDIR:-/tmp}/api-credentials-on.yaml" err="${TMPDIR:-/tmp}/api-credentials-on.err"
  local reader_only="${TMPDIR:-/tmp}/api-credentials-reader.yaml"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set clickhouse.appWriter.enabled=true; then
    fail "api-on-render" "render with the reader and the writer on failed: $(cat "$err")"
    return
  fi
  local app var
  app="$(env_names_in "$out" "app/deployment.yaml")"
  for var in "${SYSTEM_ENV[@]}"; do
    has_env "$app" "$var" && fail "api-on-$var" "the app holds $var with the reader and the writer on."
  done
  for var in CLICKHOUSE_READER_URL CLICKHOUSE_WRITER_URL; do
    has_env "$app" "$var" || fail "api-on-keeps-$var" "the app lost $var."
  done
  local workload
  for workload in "workers/deployment.yaml" "clickhouse/lwql-access-render.yaml"; do
    has_env "$(env_names_in "$out" "$workload")" CLICKHOUSE_URL ||
      fail "api-on-$workload" "$workload lost CLICKHOUSE_URL when the api's was dropped."
  done
  if ! render_to "$reader_only" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true; then
    fail "api-reader-render" "render with the reader alone failed: $(cat "$err")"
    return
  fi
  local expected
  expected="$(env_names_in "$reader_only" "app/deployment.yaml" | grep -vxF CLICKHOUSE_URL; echo CLICKHOUSE_WRITER_URL)"
  [[ "$(sort <<<"$expected")" == "$(sort <<<"$app")" ]] ||
    fail "api-on-names" "the app's env is not the reader-only render's plus the writer, minus CLICKHOUSE_URL."
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set clickhouse.appWriter.enabled=true --set workers.enabled=false; then
    fail "api-sidecar-render" "render with the workers off failed: $(cat "$err")"
    return
  fi
  [[ "$(env_count_in "$out" "app/deployment.yaml" CLICKHOUSE_URL)" == "1" ]] ||
    fail "api-sidecar" "with the workers off, CLICKHOUSE_URL is not held by the worker sidecar alone."
}

# @scenario "The api's own extra env cannot hand it the system credential back"
test_api_extra_env_cannot_restore_system_credential() {
  local out="${TMPDIR:-/tmp}/api-credentials-extra.yaml" err="${TMPDIR:-/tmp}/api-credentials-extra.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set clickhouse.appWriter.enabled=true \
    --set 'app.extraEnvs[0].name=CLICKHOUSE_URL' --set 'app.extraEnvs[0].value=http://system@clickhouse:8123/langwatch' \
    --set 'app.extraEnvs[1].name=CLICKHOUSE_PASSWORD_FILE' --set 'app.extraEnvs[1].value=/secrets/clickhouse' \
    --set 'app.extraEnvs[2].name=CLICKHOUSE_URL__eu__org1' --set 'app.extraEnvs[2].value=http://system@eu:8123/langwatch' \
    --set 'app.extraEnvs[3].name=KEPT_EXTRA' --set 'app.extraEnvs[3].value=kept'; then
    fail "api-extra-render" "render with system entries in app.extraEnvs failed: $(cat "$err")"
    return
  fi
  local app var
  app="$(env_names_in "$out" "app/deployment.yaml")"
  for var in CLICKHOUSE_URL CLICKHOUSE_PASSWORD_FILE CLICKHOUSE_URL__eu__org1; do
    has_env "$app" "$var" && fail "api-extra-$var" "app.extraEnvs handed the app $var with the reader and the writer on."
  done
  has_env "$app" KEPT_EXTRA || fail "api-extra-kept" "the app lost an unrelated app.extraEnvs entry."
}

# @scenario "With the reader or the writer off the chart gives the api what it gave before"
test_api_keeps_system_credential_without_writer() {
  local out="${TMPDIR:-/tmp}/api-credentials-off.yaml" err="${TMPDIR:-/tmp}/api-credentials-off.err"
  if ! render_to "$out" "$err" --set autogen.enabled=true --set clickhouse.appReader.enabled=true \
    --set 'app.extraEnvs[0].name=CLICKHOUSE_URL__eu__org1' --set 'app.extraEnvs[0].value=http://system@eu:8123/langwatch'; then
    fail "api-off-render" "render with the writer off failed: $(cat "$err")"
    return
  fi
  local app
  app="$(env_names_in "$out" "app/deployment.yaml")"
  has_env "$app" CLICKHOUSE_URL || fail "api-off-url" "the app lost CLICKHOUSE_URL with the writer off."
  has_env "$app" CLICKHOUSE_URL__eu__org1 || fail "api-off-route" "the app lost its CLICKHOUSE_URL__* route with the writer off."
}

test_default_renders_as_before
test_enabled_wires_writer
test_writer_needs_reader
test_existing_secret_carries_writer
test_api_drops_system_credential
test_api_extra_env_cannot_restore_system_credential
test_api_keeps_system_credential_without_writer

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: the app writer is off by default and renders as before; enabled beside the reader, a pre-install/pre-upgrade hook Secret holds its URL for the app, the workers and the render Job, with LangWatchQL on or off; enabled without the reader the chart refuses to render; an operator Secret is read instead of generated; with both on, the api holds no system URL, password or route"
