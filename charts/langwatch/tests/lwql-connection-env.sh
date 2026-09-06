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
# Postures pinned:
#   - chart-managed (default): app AND workers get all five ClickHouse vars plus
#     the PostgreSQL reader password, and NOT LWQL_SELF_PROVISION (the subchart
#     owns provisioning); the subchart emits the lwql_postgres bridge dialing the
#     chart's own PostgreSQL as the dedicated read-only role lwql_ro, on the
#     database the app itself uses (postgresql.auth.database).
#   - external ClickHouse: the app self-provisions, so it emits
#     LWQL_SELF_PROVISION=true and derives URL/user/database/tenant from
#     CLICKHOUSE_URL itself — the chart must NOT emit the four chart-managed vars.
#   - external PostgreSQL with the bridge host cancelled to "": the bridge
#     renders disabled (no CLICKHOUSE_LWQL_PG_HOST at all) rather than
#     silently dialing a Service that does not exist, and the app Deployment
#     carries a langwatch.io/lwql-postgres-bridge: disabled annotation. A
#     PARTIAL override (some other postgres.* field set while host stays
#     empty) still fails the render as a likely mistake.
#   - external PostgreSQL with an EXPLICIT (non-empty) bridge host: the operator
#     wants the bridge live against their own PostgreSQL, so the render REQUIRES
#     an operator-supplied clickhouse.lwqlAccessModel.existingSecret carrying the
#     reader password (the chart never provisions lwql_ro on a PostgreSQL it does
#     not own). Missing it fails closed with reader-role guidance; supplied, the
#     bridge renders live, the subchart mounts the operator's Secret, and the app
#     is still withheld the reader-management flag.
#
# Each test carries a plain "# Verifies:" line naming what it pins.
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

# The literal value emitted for `- name: <var>` anywhere in the render (the
# subchart's bridge env, unlike the app's, is a plain value not a secretKeyRef).
# Reads the `value:` on the line following the name and strips its quotes.
env_value_of() {
  local render="$1" var="$2"
  awk -v want="$var" '
    $0 ~ "- name: " want "$" { getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit }
  ' "$render"
}

# The secretKeyRef the app env var $3 resolves FROM, within ONE deployment's
# Source block ($2). Prints "<secretName> <key>" (space-separated); empty if the
# var is absent or is not a secretKeyRef. Used to prove which Secret a
# valueFrom.secretKeyRef env var (unlike a plain value:) points at.
secret_ref_of() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v v="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0) }
    insrc && $0 ~ "- name: " v "$" { found=1; inref=0; sn=""; next }
    found && /secretKeyRef:/ { inref=1; next }
    found && inref && /name:/ { sub(/^[[:space:]]*name:[[:space:]]*/, ""); gsub(/"/, ""); sn=$0 }
    found && inref && /key:/  { sub(/^[[:space:]]*key:[[:space:]]*/, "");  gsub(/"/, ""); print sn, $0; exit }
  ' "$render"
}

# Verifies: Chart-managed ClickHouse emits the full LangWatchQL connection on app and workers
test_chart_managed_full_connection() {
  local out="${TMPDIR:-/tmp}/lwql-conn-managed.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-managed.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "managed-render" "default render failed:
$(cat "$err")"
    return
  fi

  # Chart-managed ClickHouse + chart-managed PostgreSQL (the default): the app
  # owns the reader role, so it gets the explicit LWQL_MANAGE_POSTGRES_READER
  # flag AND the reader password. Never the flag on any external-PostgreSQL path.
  local required=(
    LWQL_CLICKHOUSE_URL
    LWQL_CLICKHOUSE_USER
    LWQL_DATABASE
    LWQL_TENANT_SETTING
    LWQL_CLICKHOUSE_PASSWORD
    LWQL_MANAGE_POSTGRES_READER
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

  # The bridge must dial as the dedicated read-only role, never the superuser:
  # the superuser's password lives under a different Secret key, so a superuser
  # bridge cannot even authenticate, and it would discard the reader isolation.
  local pg_user
  pg_user="$(env_value_of "$out" "CLICKHOUSE_LWQL_PG_USER")"
  if [[ "$pg_user" != "lwql_ro" ]]; then
    fail "managed-pg-user" \
      "the lwql_postgres bridge connects as '${pg_user:-<empty>}', expected the dedicated reader 'lwql_ro'. A superuser bridge fails to authenticate (its password is under postgres-password, not lwql_pg_password) and discards reader isolation."
  fi

  # The bridge reads the app's OWN database. It must track postgresql.auth.database,
  # not a hardcoded literal — render with a non-default database and require it to
  # follow.
  local dbout="${TMPDIR:-/tmp}/lwql-conn-managed-db.yaml"
  local dberr="${TMPDIR:-/tmp}/lwql-conn-managed-db.err"
  if render_to "$dbout" "$dberr" t \
      --set autogen.enabled=true \
      --set postgresql.auth.database=analytics_db \
      --set clickhouse.lwqlAccessModel.postgres.database=analytics_db; then
    local pg_db
    pg_db="$(env_value_of "$dbout" "CLICKHOUSE_LWQL_PG_DATABASE")"
    if [[ "$pg_db" != "analytics_db" ]]; then
      fail "managed-pg-db" \
        "the lwql_postgres bridge reads database '${pg_db:-<empty>}', expected 'analytics_db' (postgresql.auth.database). The bridge must read the app's own database."
    fi
  else
    fail "managed-pg-db-render" "render with a non-default database failed:
$(cat "$dberr")"
  fi
}

# Verifies: External ClickHouse self-provisions and omits the chart-managed connection vars
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

# Verifies: external PostgreSQL with the bridge host cancelled to "" (every
# external-PostgreSQL example/profile does this) renders successfully with the
# bridge disabled — surfaced via the app Deployment's annotation — and emits no
# CLICKHOUSE_LWQL_PG_HOST at all, instead of silently pointing it at the
# nonexistent in-cluster PostgreSQL Service.
test_external_postgres_no_host_disables_bridge() {
  local out="${TMPDIR:-/tmp}/lwql-conn-extpg.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-extpg.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set postgresql.chartManaged=false \
      --set postgresql.external.connectionString.value="postgresql://u:p@extpg:5432/langwatch" \
      --set clickhouse.lwqlAccessModel.postgres.host=""; then
    fail "extpg-no-host-render-failed" \
      "render failed with postgresql.chartManaged=false and the bridge host cancelled to \"\". This must render successfully with the bridge disabled (no shipped LangWatchQL view reads through it yet, langwatch-saas#7387) — got:
$(cat "$err")"
    return
  fi
  if ! grep -q 'langwatch.io/lwql-postgres-bridge: "disabled"' "$out"; then
    fail "extpg-no-host-annotation" \
      "render succeeded but did not annotate the app Deployment with langwatch.io/lwql-postgres-bridge: disabled."
  fi
  if grep -q 'CLICKHOUSE_LWQL_PG_HOST' "$out"; then
    fail "extpg-no-host-env-emitted" \
      "render emitted CLICKHOUSE_LWQL_PG_HOST although the bridge host was cancelled to \"\" for an external PostgreSQL — this would silently target the non-existent in-cluster PostgreSQL Service."
  fi

  # External PostgreSQL owns lwql_ro out of band: the app must NOT be told to
  # manage the reader role (LWQL_MANAGE_POSTGRES_READER) or handed a reader
  # password it must not use. Running CREATE/ALTER ROLE against an operator's
  # PostgreSQL as the DATABASE_URL user would crashloop the pod or rotate the
  # operator's reader password.
  local names
  names="$(env_names_in "$out" "app/deployment.yaml")"
  local var
  for var in LWQL_MANAGE_POSTGRES_READER LWQL_POSTGRES_READER_PASSWORD; do
    if has_env "$names" "$var"; then
      fail "extpg-no-host-$var" \
        "external PostgreSQL emitted $var on the app. The reader role is owned out of band here; the app must neither manage it nor hold its credential."
    fi
  done
}

# Verifies: a PARTIAL external-PostgreSQL bridge override (some other
# postgres.* field changed while host stays empty) still fails closed — that
# looks like a forgotten host, not a deliberate disable.
test_external_postgres_partial_config_fails() {
  local out="${TMPDIR:-/tmp}/lwql-conn-extpg-partial.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-extpg-partial.err"
  if render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set postgresql.chartManaged=false \
      --set postgresql.external.connectionString.value="postgresql://u:p@extpg:5432/langwatch" \
      --set clickhouse.lwqlAccessModel.postgres.host="" \
      --set clickhouse.lwqlAccessModel.postgres.database=analytics_db; then
    fail "extpg-partial-rendered" \
      "render succeeded with clickhouse.lwqlAccessModel.postgres.database overridden but .host left empty — that is a partial, likely-mistaken configuration and must fail closed."
    return
  fi
  if ! grep -q 'clickhouse.lwqlAccessModel.postgres.host is empty but' "$err"; then
    fail "extpg-partial-message" \
      "render failed, but not with the expected partial-config guidance. Got:
$(cat "$err")"
  fi
}

# Verifies: external PostgreSQL WITH an explicit (non-empty) bridge host but NO
# operator-supplied clickhouse.lwqlAccessModel.existingSecret fails the render.
# The bridge would dial the operator's own PostgreSQL as lwql_ro, but the app
# never provisions that role on a PostgreSQL it does not own and url-secret.yaml's
# autogenerated lwql_pg_password is a password nobody set there — so the guard
# forces the operator to supply a real reader credential via a Secret they own.
test_external_postgres_explicit_host_requires_secret() {
  local out="${TMPDIR:-/tmp}/lwql-conn-extpg-host-nosecret.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-extpg-host-nosecret.err"
  if render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set postgresql.chartManaged=false \
      --set postgresql.external.connectionString.value="postgresql://u:p@extpg:5432/langwatch" \
      --set clickhouse.lwqlAccessModel.postgres.host="extpg.example.com"; then
    fail "extpg-host-nosecret-rendered" \
      "render succeeded with an explicit external-PostgreSQL bridge host but no clickhouse.lwqlAccessModel.existingSecret. ClickHouse would dial lwql_ro with a password nobody set — this must fail closed."
    return
  fi
  # The guidance must name the reader role the operator has to create.
  if ! grep -q 'lwql_ro' "$err"; then
    fail "extpg-host-nosecret-message" \
      "render failed, but not with the expected reader-role guidance (no mention of lwql_ro). Got:
$(cat "$err")"
  fi
}

# Verifies: external PostgreSQL WITH an explicit bridge host AND an
# operator-supplied clickhouse.lwqlAccessModel.existingSecret renders
# successfully; the lwql_postgres bridge is present, dials the explicit host, and
# the subchart mounts the OPERATOR's Secret (not the default ClickHouse
# credentials Secret / url-secret.yaml's autogenerated value). The app is still
# NOT told to manage the reader role — external PostgreSQL owns lwql_ro.
test_external_postgres_explicit_host_with_secret() {
  local secret="operator-lwql-secret"
  local host="extpg.example.com"
  local out="${TMPDIR:-/tmp}/lwql-conn-extpg-host-secret.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-extpg-host-secret.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set postgresql.chartManaged=false \
      --set postgresql.external.connectionString.value="postgresql://u:p@extpg:5432/langwatch" \
      --set clickhouse.lwqlAccessModel.postgres.host="$host" \
      --set clickhouse.lwqlAccessModel.existingSecret="$secret"; then
    fail "extpg-host-secret-render" \
      "render failed with an explicit external-PostgreSQL bridge host and an operator-supplied existingSecret — this is the compliant posture and must render:
$(cat "$err")"
    return
  fi

  # The bridge renders and dials the explicit host.
  local pg_host
  pg_host="$(env_value_of "$out" "CLICKHOUSE_LWQL_PG_HOST")"
  if [[ "$pg_host" != "$host" ]]; then
    fail "extpg-host-secret-bridge" \
      "the lwql_postgres bridge host is '${pg_host:-<empty>}', expected the explicit '$host'. The bridge must render live against the operator's PostgreSQL."
  fi

  # The subchart must mount the OPERATOR's Secret, so the reader password is the
  # one the operator set on lwql_ro — never the default clickhouse credentials
  # Secret carrying url-secret.yaml's autogenerated lwql_pg_password.
  if ! grep -q "secretName: $secret" "$out"; then
    fail "extpg-host-secret-mount" \
      "the render does not mount the operator's Secret '$secret' (clickhouse.lwqlAccessModel.existingSecret). ClickHouse must dial lwql_ro with the operator-set password, not the autogenerated one."
  fi

  # The operator's Secret backs the langwatch_lwql QUERY IDENTITY too, not only
  # the bridge reader: existingSecret redirects langwatch.clickhouse.lwqlSecretName,
  # so the app's LWQL_CLICKHOUSE_PASSWORD must resolve from the operator Secret
  # via key lwql_password — NOT the chart's default ClickHouse credentials Secret.
  # The mount is optional:true, so a Secret carrying only lwql_pg_password would
  # silently leave langwatch_lwql with a password nobody set and refuse every
  # query — this pins that the same operator Secret sources both credentials.
  local ch_ref ch_secret ch_key
  ch_ref="$(secret_ref_of "$out" "app/deployment.yaml" "LWQL_CLICKHOUSE_PASSWORD")"
  ch_secret="${ch_ref%% *}"
  ch_key="${ch_ref##* }"
  if [[ "$ch_secret" != "$secret" || "$ch_key" != "lwql_password" ]]; then
    fail "extpg-host-secret-ch-password" \
      "LWQL_CLICKHOUSE_PASSWORD resolves from Secret '${ch_secret:-<empty>}' key '${ch_key:-<empty>}', expected the operator Secret '$secret' key 'lwql_password'. clickhouse.lwqlAccessModel.existingSecret must back the langwatch_lwql query identity too (via langwatch.clickhouse.lwqlSecretName), not only the bridge reader password — otherwise the identity gets a password nobody set and every LangWatchQL query is refused (optional:true mount)."
  fi

  # External PostgreSQL owns lwql_ro out of band: the app must NOT be told to
  # manage the reader role even when the bridge is live.
  local names
  names="$(env_names_in "$out" "app/deployment.yaml")"
  if has_env "$names" "LWQL_MANAGE_POSTGRES_READER"; then
    fail "extpg-host-secret-manage-flag" \
      "the app emits LWQL_MANAGE_POSTGRES_READER on external PostgreSQL. The reader role is owned out of band here; the app must never run role DDL against a PostgreSQL it does not own."
  fi
}

test_chart_managed_full_connection
test_external_self_provision
test_external_postgres_no_host_disables_bridge
test_external_postgres_partial_config_fails
test_external_postgres_explicit_host_requires_secret
test_external_postgres_explicit_host_with_secret

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: all 6 LangWatchQL connection postures pinned — (1) chart-managed ClickHouse + chart-managed PostgreSQL wires the full connection plus the reader-management flag on app and workers; (2) external ClickHouse self-provisions and omits the chart-managed vars; (3) external PostgreSQL with the bridge host cancelled renders the bridge disabled and hands the app neither the manage flag nor the reader password; (4) a partial external-PostgreSQL override fails closed; (5) external PostgreSQL with an explicit bridge host but no operator existingSecret fails closed with reader-role guidance; (6) external PostgreSQL with an explicit host AND an operator existingSecret renders live, mounts the operator's Secret, sources the app's LWQL_CLICKHOUSE_PASSWORD (langwatch_lwql query identity) from that same operator Secret via key lwql_password, and still withholds the reader-management flag"
