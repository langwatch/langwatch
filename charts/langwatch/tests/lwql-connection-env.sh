#!/usr/bin/env bash
#
# Renders the chart and asserts the LangWatchQL RESTRICTED CONNECTION is wired
# completely, not just its password. This is the P1 from review 5115397477: with
# LWQL_SELF_PROVISION off (chart-managed ClickHouse), lwqlConnectionFromEnv
# (platform/app/src/server/analytics/lwql/executor.ts) requires ALL of
# LWQL_CLICKHOUSE_URL, LWQL_CLICKHOUSE_USER, LWQL_DATABASE, LWQL_TENANT_SETTING
# and LWQL_CLICKHOUSE_PASSWORD, and returns null on any missing one. Emitting
# only the passwords made the executor refuse EVERY default-install query as
# unconfigured — invisible in the template source, visible only in the render.
#
# Two postures are pinned:
#   - chart-managed (default): app AND workers get all five ClickHouse vars plus
#     the PostgreSQL reader password, and NOT LWQL_SELF_PROVISION (the subchart
#     owns provisioning); the subchart emits the lwql_postgres bridge host, so
#     the named collection the boot-time catalog needs is present.
#   - external ClickHouse: the app self-provisions, so it emits
#     LWQL_SELF_PROVISION=true and derives URL/user/database/tenant from
#     CLICKHOUSE_URL itself — the chart must NOT emit the four chart-managed vars.
#
# Scenario bindings use the same `@scenario` token as the sibling suites: a
# hash-comment above the test function it verifies; the next line that is neither
# blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/lwql-connection-env.sh

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

# All env var names (the `- name: X` keys) emitted inside ONE deployment's
# Source block. $2 is the template path fragment identifying the workload, e.g.
# "app/deployment.yaml" or "workers/deployment.yaml".
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

# @scenario "Chart-managed ClickHouse emits the full LangWatchQL connection on app and workers"
test_chart_managed_full_connection() {
  local out="${TMPDIR:-/tmp}/lwql-conn-managed.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-managed.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "managed-render" "default render failed:
$(cat "$err")"
    return
  fi

  local required=(
    LWQL_CLICKHOUSE_URL
    LWQL_CLICKHOUSE_USER
    LWQL_DATABASE
    LWQL_TENANT_SETTING
    LWQL_CLICKHOUSE_PASSWORD
    LWQL_POSTGRES_READER_PASSWORD
  )

  local workload names var
  for workload in "app/deployment.yaml" "workers/deployment.yaml"; do
    names="$(env_names_in "$out" "$workload")"
    if [[ -z "$names" ]]; then
      fail "managed-empty-$workload" \
        "no env vars found for $workload — did the Source path change?"
      continue
    fi
    for var in "${required[@]}"; do
      if ! has_env "$names" "$var"; then
        fail "managed-missing-$workload-$var" \
          "$workload does not emit $var. With LWQL_SELF_PROVISION off, lwqlConnectionFromEnv requires the full set and refuses every query when one is missing."
      fi
    done
    # The DDL switch belongs only to the self-provisioning (external) path.
    if has_env "$names" "LWQL_SELF_PROVISION"; then
      fail "managed-selfprovision-$workload" \
        "$workload emits LWQL_SELF_PROVISION on chart-managed ClickHouse. The subchart owns provisioning here; a second SQL owner would wedge the same entity names."
    fi
  done

  # The boot-time ClickHouse catalog references the lwql_postgres named
  # collection; the subchart renders it only when the bridge host resolves.
  # Auto-derived to the chart's own PostgreSQL, it must be present by default.
  if ! grep -q 'CLICKHOUSE_LWQL_PG_HOST' "$out"; then
    fail "managed-no-pg-bridge" \
      "the clickhouse-serverless subchart did not emit CLICKHOUSE_LWQL_PG_HOST, so the lwql_postgres named collection is omitted and the boot-time catalog provisioning fails on it. The bridge host must auto-derive to the chart's PostgreSQL on the default path."
  fi
}

# @scenario "External ClickHouse self-provisions and omits the chart-managed connection vars"
test_external_self_provision() {
  local out="${TMPDIR:-/tmp}/lwql-conn-external.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-external.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set clickhouse.chartManaged=false \
      --set clickhouse.external.url.value="http://user:pass@ch.example:8123/langwatch"; then
    fail "external-render" "external render failed:
$(cat "$err")"
    return
  fi

  local names
  names="$(env_names_in "$out" "app/deployment.yaml")"

  if ! has_env "$names" "LWQL_SELF_PROVISION"; then
    fail "external-no-selfprovision" \
      "external ClickHouse must emit LWQL_SELF_PROVISION=true so the app provisions the access model itself; it was absent."
  fi
  if ! has_env "$names" "LWQL_CLICKHOUSE_PASSWORD"; then
    fail "external-no-password" \
      "external ClickHouse must still emit LWQL_CLICKHOUSE_PASSWORD (the app authenticates as langwatch_lwql regardless of who provisioned it)."
  fi

  # The four chart-managed vars must NOT appear: the app derives them from
  # CLICKHOUSE_URL, and emitting a fixed URL/database here would split
  # provisioning from querying.
  local var
  for var in LWQL_CLICKHOUSE_URL LWQL_CLICKHOUSE_USER LWQL_DATABASE LWQL_TENANT_SETTING; do
    if has_env "$names" "$var"; then
      fail "external-unexpected-$var" \
        "external ClickHouse emitted $var. Self-provisioning derives it from CLICKHOUSE_URL; a chart-emitted value would target a different server than the one queries provisioned."
    fi
  done
}

test_chart_managed_full_connection
test_external_self_provision

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: chart-managed ClickHouse wires the full LangWatchQL connection on app and workers; external ClickHouse self-provisions and omits the chart-managed vars"
