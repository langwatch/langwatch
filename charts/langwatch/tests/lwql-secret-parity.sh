#!/usr/bin/env bash
#
# Renders the chart and asserts the ONE invariant Design C rests on: the Secret
# the app/workers read the langwatch_lwql query password from is the SAME Secret
# the chart-managed ClickHouse pod mounts to CREATE that identity. If the two
# names ever disagree, the query password silently diverges from the provisioned
# one and every LangWatchQL query fails auth against a server that is otherwise
# healthy — a split visible only in the rendered output, never in the template
# source, because the two names come from two different helpers
# (langwatch.clickhouse.lwqlSecretName here, clickhouse-serverless.lwqlSecretName
# in the subchart) that are only guaranteed to agree by shared values, not by
# construction.
#
# It also pins the chart's DEFAULT posture (autogen.enabled=false,
# values.yaml:92), which no other CI leg exercises — every render in the
# workflow's preset loop forces autogen on. With autogen off the chart must NOT
# materialise its own ClickHouse credentials Secret (the operator owns it), yet
# the app must still point at that operator-provided Secret by name.
#
# This executes the template pipeline rather than reading it. Both secret names
# sit behind nested conditionals (lwql.enabled, clickhouse.chartManaged) and a
# helper chain that trunc-36s a release name on one fallback path but not the
# other (_helpers.tpl :: langwatch.clickhouse.lwqlSecretName, ~:1204), so a
# divergence on a long release name is visible only by rendering both sides.
#
# Scenario bindings use the same `@scenario` token as the other suites in this
# directory, expressed as a hash-comment above the test function it verifies.
# The next line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/lwql-secret-parity.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Render the chart, tolerating a non-zero exit so an EXPECTED render failure is
# an assertion outcome rather than a bare `set -e` abort with no context. Writes
# stdout to $1, stderr to $2, returns helm's exit status.
render_to() {
  local out="$1" err="$2" release="$3"
  shift 3
  local status
  # shellcheck disable=SC2086
  helm template "$release" . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# The Secret name the app Deployment's LWQL_CLICKHOUSE_PASSWORD reads from —
# i.e. what langwatch.clickhouse.lwqlSecretName resolved to. Scoped to the app
# Deployment so a name emitted elsewhere can never satisfy the assertion, and
# anchored past the env-var line itself (which also contains "name:") to the
# `name:` under its secretKeyRef.
app_lwql_secret_name() {
  awk '
    /^# Source:/ { insrc = ($0 ~ /templates\/app\/deployment\.yaml/) }
    insrc && /- name: LWQL_CLICKHOUSE_PASSWORD/ { grab = 1; next }
    grab && /secretKeyRef:/ { want = 1; next }
    want && /[[:space:]]name:[[:space:]]/ {
      sub(/^[[:space:]]*name:[[:space:]]*/, ""); print; exit
    }
  ' "$1"
}

# The Secret name the clickhouse-serverless StatefulSet mounts as lwql-secrets —
# i.e. what clickhouse-serverless.lwqlSecretName resolved to. The subchart is
# aliased `clickhouse`, so its templates render under charts/clickhouse/.
#
# `- name: lwql-secrets` appears twice: once as a container volumeMount and once
# as the volume definition, and the mount comes first — its following line is
# `mountPath:`, and the next `secretName:` after it belongs to the UNRELATED
# credentials volume. So a match that hits `mountPath:` before `secretName:` is
# the mount, not the volume, and must be discarded; only the volume block
# (`secret:` then `secretName:`) is the name we want.
sts_lwql_secret_name() {
  awk '
    /^# Source:/ { insrc = ($0 ~ /clickhouse\/templates\/statefulset\.yaml/) }
    insrc && /- name: lwql-secrets/ { grab = 1; next }
    grab && /mountPath:/ { grab = 0; next }
    grab && /secretName:/ {
      sub(/^[[:space:]]*secretName:[[:space:]]*/, ""); print; exit
    }
  ' "$1"
}

# @scenario "The app reads the LangWatchQL password from the Secret the ClickHouse pod mounts"
test_lwql_secret_name_parity() {
  local out="${TMPDIR:-/tmp}/lwql-parity-default.yaml"
  local err="${TMPDIR:-/tmp}/lwql-parity-default.err"
  if ! render_to "$out" "$err" lw --set autogen.enabled=true; then
    fail "parity-default-render" "default render failed:
$(cat "$err")"
    return
  fi

  local app sts
  app="$(app_lwql_secret_name "$out")"
  sts="$(sts_lwql_secret_name "$out")"

  if [[ -z "$app" || -z "$sts" ]]; then
    fail "parity-default-empty" \
      "could not extract both LWQL secret names (app='$app', statefulset='$sts'). Did the env var or volume name change?"
    return
  fi

  if [[ "$app" != "$sts" ]]; then
    fail "parity-default-mismatch" \
      "the app reads the LWQL password from Secret '$app' but the ClickHouse pod mounts '$sts' to create the identity. The query password will diverge from the provisioned one and every LangWatchQL query will fail auth. langwatch.clickhouse.lwqlSecretName and clickhouse-serverless.lwqlSecretName must resolve identically."
  fi
}

# @scenario "The two LWQL Secret names stay identical on a release name longer than 36 characters"
test_lwql_secret_name_parity_long_release() {
  # 41 chars — past the subchart's trunc-36 fullname fallback, within helm's
  # 53-char release-name limit. On the supported path (auth.existingSecret set,
  # its default `{{ .Release.Name }}-clickhouse`) BOTH helpers key off that same
  # non-truncated name, so they must still match.
  local release="lwqlparity-release-name-over-thirtysix-ab"
  local out="${TMPDIR:-/tmp}/lwql-parity-long.yaml"
  local err="${TMPDIR:-/tmp}/lwql-parity-long.err"
  if ! render_to "$out" "$err" "$release" --set autogen.enabled=true; then
    fail "parity-long-render" "long-release render failed:
$(cat "$err")"
    return
  fi

  local app sts
  app="$(app_lwql_secret_name "$out")"
  sts="$(sts_lwql_secret_name "$out")"

  if [[ "$app" != "$sts" ]]; then
    fail "parity-long-mismatch" \
      "on a >36-char release the app reads '$app' but the ClickHouse pod mounts '$sts'. The subchart truncates the release name to 36 on its fullname fallback; the parent helper does not. Both must key off auth.existingSecret so the truncation never bites."
  fi

  # The documented divergence branch: auth.existingSecret hand-emptied on a
  # long release is the ONLY config where the two fallbacks differ. It must
  # never render two disagreeing names silently — either it fails loudly, or
  # (were the fallbacks ever reconciled) it still matches.
  local dout="${TMPDIR:-/tmp}/lwql-parity-diverge.yaml"
  local derr="${TMPDIR:-/tmp}/lwql-parity-diverge.err"
  if render_to "$dout" "$derr" "$release" \
      --set autogen.enabled=true --set clickhouse.auth.existingSecret=; then
    local dapp dsts
    dapp="$(app_lwql_secret_name "$dout")"
    dsts="$(sts_lwql_secret_name "$dout")"
    if [[ "$dapp" != "$dsts" ]]; then
      fail "parity-diverge-silent" \
        "emptying auth.existingSecret on a >36-char release rendered two disagreeing LWQL secret names (app='$dapp', statefulset='$dsts') WITHOUT failing. This is the exact silent divergence the helper comment warns about — the render must abort instead."
    fi
  fi
  # A failed render here is the intended, safe outcome — the chart refuses the
  # unsupported config rather than diverging — so it is not a failure.
}

# @scenario "With autogen off the chart renders no ClickHouse credentials Secret but the app still names the operator Secret"
test_autogen_off_posture() {
  # autogen off + chart-managed ClickHouse requires an operator-owned
  # auth.existingSecret (the validation forbids the default name), plus the app
  # Secret handed in via secrets.existingSecret with the gateway and langyagent
  # subcharts pointed at the same name, and an explicit credentialsEncryptionKey.
  local ch_secret="operator-ch-secret"
  local app_secret="operator-app-secret"
  local out="${TMPDIR:-/tmp}/lwql-autogen-off.yaml"
  local err="${TMPDIR:-/tmp}/lwql-autogen-off.err"
  if ! render_to "$out" "$err" lw \
      --set autogen.enabled=false \
      --set secrets.existingSecret="$app_secret" \
      --set gateway.secrets.existingSecretName="$app_secret" \
      --set langyagent.secrets.existingSecretName="$app_secret" \
      --set app.credentialsEncryptionKey.value=deadbeefdeadbeef \
      --set clickhouse.auth.existingSecret="$ch_secret"; then
    fail "autogen-off-render" "autogen-off render failed:
$(cat "$err")"
    return
  fi

  # The chart must NOT materialise its own ClickHouse credentials Secret — the
  # operator owns it. url-secret.yaml is gated on autogen.enabled, so it must
  # emit nothing at all.
  if grep -q "templates/clickhouse/url-secret.yaml" "$out"; then
    fail "autogen-off-url-secret" \
      "url-secret.yaml rendered with autogen.enabled=false. The operator owns the ClickHouse credentials Secret in this posture; the chart must not create (and on every ArgoCD reconcile, rotate) one."
  fi

  # ...but the app must still reference the operator-provided Secret by name,
  # never an empty or undefined one.
  local app
  app="$(app_lwql_secret_name "$out")"
  if [[ "$app" != "$ch_secret" ]]; then
    fail "autogen-off-app-secret" \
      "with autogen off the app reads its LWQL password from Secret '$app', expected the operator-provided '$ch_secret' (clickhouse.auth.existingSecret). An empty or wrong name here means the password key resolves against nothing."
  fi
}

# The value emitted for a plain (non-secretKeyRef) `- name: <var>` env var in the
# app Deployment. Scoped to that Source block, anchored past the env-name line.
app_env_value() {
  awk -v want="$2" '
    /^# Source:/ { insrc = ($0 ~ /templates\/app\/deployment\.yaml/) }
    insrc && $0 ~ ("- name: " want "$") {
      getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }
  ' "$1"
}

# The value emitted for a plain `- name: <var>` env var ANYWHERE in the render.
# The bridge env (CLICKHOUSE_LWQL_PG_USER) lives on the subchart StatefulSet, not
# the app Deployment, so it is not app-scoped.
render_env_value() {
  awk -v want="$2" '
    $0 ~ ("- name: " want "$") {
      getline; sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }
  ' "$1"
}

# Verifies: The chart's LangWatchQL identity, tenant setting AND bridge reader
# user match the app's constants, so the three copies never drift out of a
# rendered install.
#
# langwatch_lwql and custom_api_key_hash are access-model constants baked into the
# clickhouse-serverless image AND carried by the app as LWQL_CONNECTION_DEFAULTS
# (connection.ts) AND emitted by the chart helpers; lwql_ro is the reader role
# baked into the same image AND carried by the app as
# LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole (selfProvisioning.ts, via
# LWQL_POSTGRES_READER_ROLE in productionProvisioning.ts) AND rendered as the
# subchart's CLICKHOUSE_LWQL_PG_USER. If the chart emits a user, tenant setting
# or bridge reader the app does not expect, every query authenticates, filters,
# or bridges against the wrong thing. Pin the chart's rendered values to the app
# source directly — no build, just the literals.
test_lwql_connection_defaults_parity() {
  local conn_ts="../../platform/app/src/server/analytics/lwql/connection.ts"
  local self_prov_ts="../../platform/app/src/server/analytics/lwql/provisioning/selfProvisioning.ts"
  local prod_prov_ts="../../platform/app/src/server/analytics/lwql/provisioning/productionProvisioning.ts"
  if [[ ! -f "$conn_ts" || ! -f "$self_prov_ts" || ! -f "$prod_prov_ts" ]]; then
    fail "defaults-parity-source" \
      "cannot find the app source (connection.ts / selfProvisioning.ts / productionProvisioning.ts) relative to charts/langwatch — the parity check needs it."
    return
  fi
  local app_user app_tenant
  app_user="$(sed -n 's/.*restrictedUser:[[:space:]]*"\([^"]*\)".*/\1/p' "$conn_ts" | head -1)"
  app_tenant="$(sed -n 's/.*tenantSetting:[[:space:]]*"\([^"]*\)".*/\1/p' "$conn_ts" | head -1)"
  if [[ -z "$app_user" || -z "$app_tenant" ]]; then
    fail "defaults-parity-extract" \
      "could not read restrictedUser/tenantSetting from LWQL_CONNECTION_DEFAULTS (got user='$app_user', tenant='$app_tenant'). Did the constant's shape change?"
    return
  fi

  # The reader role: selfProvisioning.ts binds it to LWQL_POSTGRES_READER_ROLE,
  # whose literal lives in productionProvisioning.ts. Assert the binding, then
  # read the literal — so a rename in either file is caught here.
  if ! grep -q 'postgresReaderRole:[[:space:]]*LWQL_POSTGRES_READER_ROLE' "$self_prov_ts"; then
    fail "defaults-parity-reader-binding" \
      "selfProvisioning.ts no longer binds LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole to LWQL_POSTGRES_READER_ROLE — the bridge reader parity check can no longer follow the constant."
    return
  fi
  local app_reader
  app_reader="$(sed -n 's/.*LWQL_POSTGRES_READER_ROLE[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$prod_prov_ts" | head -1)"
  if [[ -z "$app_reader" ]]; then
    fail "defaults-parity-reader-extract" \
      "could not read LWQL_POSTGRES_READER_ROLE from productionProvisioning.ts (got '$app_reader'). Did the constant's shape change?"
    return
  fi

  local out="${TMPDIR:-/tmp}/lwql-defaults-parity.yaml"
  local err="${TMPDIR:-/tmp}/lwql-defaults-parity.err"
  if ! render_to "$out" "$err" lw --set autogen.enabled=true; then
    fail "defaults-parity-render" "default render failed:
$(cat "$err")"
    return
  fi

  local ch_user ch_tenant ch_reader
  ch_user="$(app_env_value "$out" "LWQL_CLICKHOUSE_USER")"
  ch_tenant="$(app_env_value "$out" "LWQL_TENANT_SETTING")"
  ch_reader="$(render_env_value "$out" "CLICKHOUSE_LWQL_PG_USER")"
  if [[ "$ch_user" != "$app_user" ]]; then
    fail "defaults-parity-user" \
      "the chart emits LWQL_CLICKHOUSE_USER='$ch_user' but the app's LWQL_CONNECTION_DEFAULTS.restrictedUser is '$app_user'. langwatch.lwql.restrictedUser (helper), the subchart image, and connection.ts must all name the same identity."
  fi
  if [[ "$ch_tenant" != "$app_tenant" ]]; then
    fail "defaults-parity-tenant" \
      "the chart emits LWQL_TENANT_SETTING='$ch_tenant' but the app's LWQL_CONNECTION_DEFAULTS.tenantSetting is '$app_tenant'. langwatch.lwql.tenantSetting (helper), the subchart image, and connection.ts must all name the same setting."
  fi
  if [[ "$ch_reader" != "$app_reader" ]]; then
    fail "defaults-parity-reader" \
      "the subchart renders CLICKHOUSE_LWQL_PG_USER='$ch_reader' but the app's LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole is '$app_reader'. clickhouse.lwqlAccessModel.postgres.user (default), the subchart image, and selfProvisioning.ts must all name the same reader role the app converges and grants."
  fi
}

# The value of a key inside the `postgres:` sub-block of clickhouse.lwqlAccessModel
# in values.yaml. Those value lines are indented 6 spaces (the block sits under
# `    postgres:` at 4); the same key names appear elsewhere at 4-space indent
# (lwqlAccessModel.passwordSecretKey, .database), so the 6-space anchor is what
# disambiguates the bridge default from the top-level one.
values_postgres_default() {
  sed -n -E "s/^      $1:[[:space:]]*([^[:space:]#]+).*/\1/p" values.yaml | head -1
}

# Verifies: the literal defaults hardcoded in the langwatch.validateSecrets bridge
# guards (_helpers.tpl) still match the values.yaml defaults they mirror. The
# guards read `$bridge.database | default "langwatch"`, `$bridge.user | default
# "lwql_ro"` and `$bridge.passwordSecretKey | default "lwql_pg_password"` to detect
# a partial external-PostgreSQL config and to build the external-host guidance. If
# a values.yaml default is changed without updating those literals, the guard
# silently compares against the wrong baseline. This is a regression fence, not a
# refactor — it does not centralize the literals, only pins the two copies together.
test_bridge_guard_defaults_parity() {
  local helpers="templates/_helpers.tpl"
  local key val
  # values.yaml key -> the $bridge.<field> the guard reads it as.
  for pair in "database:database" "user:user" "passwordSecretKey:passwordSecretKey"; do
    key="${pair%%:*}"
    local field="${pair##*:}"
    val="$(values_postgres_default "$key")"
    if [[ -z "$val" ]]; then
      fail "guard-defaults-values" \
        "could not read clickhouse.lwqlAccessModel.postgres.$key from values.yaml (6-space-anchored). Did the block's shape or indentation change?"
      continue
    fi
    if ! grep -qF "\$bridge.$field | default \"$val\"" "$helpers"; then
      fail "guard-defaults-mismatch-$key" \
        "values.yaml sets clickhouse.lwqlAccessModel.postgres.$key='$val' but _helpers.tpl's validateSecrets bridge guards do not read \$bridge.$field | default \"$val\". A values default changed without updating the guard literal — the partial-config and external-host guards now compare against a stale baseline."
    fi
  done
}

test_lwql_secret_name_parity
test_lwql_secret_name_parity_long_release
test_autogen_off_posture
test_lwql_connection_defaults_parity
test_bridge_guard_defaults_parity

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: LWQL query Secret matches the ClickHouse-mounted Secret; autogen-off renders no credentials Secret while still naming the operator's; the rendered LWQL identity, tenant setting and bridge reader user match the app constants; and the validateSecrets bridge-guard default literals (database/user/passwordSecretKey) match the values.yaml defaults they mirror"
