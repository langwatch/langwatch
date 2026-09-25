#!/usr/bin/env bash
#
# Renders the chart and asserts the LangWatchQL query credentials are wired
# exactly (issue #8258: the app always owns the LWQL access model, on every
# ClickHouse/PostgreSQL posture). The chart's only job is handing the app and
# workers the two passwords it converges the access model from —
# LWQL_CLICKHOUSE_PASSWORD and LWQL_POSTGRES_READER_PASSWORD, both from a
# Secret (the chart-owned LWQL password Secret, or the operator's
# existingSecret) — and nothing else. No chart-rendered connection vars
# (LWQL_CLICKHOUSE_URL/USER/DATABASE/TENANT_SETTING), no DDL switch
# (LWQL_SELF_PROVISION no longer exists — the app never reads it), and no
# LWQL_MANAGE_POSTGRES_READER (the app converges lwql_ro on every path from
# LWQL_POSTGRES_READER_PASSWORD, so there is nothing left to switch on). Each
# of the two passwords must also be a valueFrom/secretKeyRef, never a plain
# literal value — the chart never has an actual password to inline.
#
# Postures pinned:
#   - chart-managed ClickHouse (default): app AND workers get exactly the two
#     passwords, nothing else LWQL-shaped.
#   - external ClickHouse: identical two vars.
#   - external PostgreSQL: identical two vars, render succeeds.
#   - lwql.enabled=false: none of the LWQL vars at all.
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
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

# True if the `- name: <var>` entry within ONE deployment's Source block ($2)
# is a valueFrom/secretKeyRef (as opposed to a plain `value:` literal). Scoped
# to the Source block so it cannot cross into another workload's block of the
# same multi-doc render.
is_secret_ref() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v v="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0); found=0; vf=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && /^[[:space:]]*- name:[[:space:]]/ && $0 !~ ("- name: " v "$") { found=0 }
    found && /valueFrom:/ { vf=1 }
    found && vf && /secretKeyRef:/ { print "yes"; exit }
  ' "$render" | grep -qxF "yes"
}

# Echoes the plain `value:` of the `- name: <var>` entry within ONE deployment's
# Source block ($2). Empty if the var is absent or is a valueFrom entry.
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

assert_two_passwords_only() {
  local names="$1" workload="$2" label="$3" render="$4"
  local var
  for var in LWQL_CLICKHOUSE_PASSWORD LWQL_POSTGRES_READER_PASSWORD; do
    if ! has_env "$names" "$var"; then
      fail "$label-missing-$workload-$var" \
        "$workload does not emit $var. The app always converges the LWQL access model from these two passwords, on every posture."
      continue
    fi
    if ! is_secret_ref "$render" "$workload" "$var"; then
      fail "$label-not-secretref-$workload-$var" \
        "$workload emits $var as a plain value, not a valueFrom/secretKeyRef. Both LWQL passwords must always come from a Secret, never a literal in the rendered manifest."
    fi
  done
  for var in LWQL_SELF_PROVISION LWQL_MANAGE_POSTGRES_READER LWQL_CLICKHOUSE_URL LWQL_CLICKHOUSE_USER LWQL_DATABASE LWQL_TENANT_SETTING; do
    if has_env "$names" "$var"; then
      fail "$label-unexpected-$workload-$var" \
        "$workload emits $var. It no longer exists (issue #8258) — the app derives everything but the two passwords itself."
    fi
  done
}

# @scenario "The application self-provisions the LangWatchQL access model on every deployment"
test_chart_managed_two_passwords_only() {
  local out="${TMPDIR:-/tmp}/lwql-conn-managed.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-managed.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "managed-render" "default render failed:
$(cat "$err")"
    return
  fi

  local workload names
  for workload in "app/deployment.yaml" "workers/deployment.yaml"; do
    names="$(env_names_in "$out" "$workload")"
    if [[ -z "$names" ]]; then
      fail "managed-empty-$workload" \
        "no env vars found for $workload — did the Source path change?"
      continue
    fi
    assert_two_passwords_only "$names" "$workload" "managed" "$out"
  done

  # No chart template renders any part of the access model any more — the
  # subchart's CLICKHOUSE_LWQL_* config env must be entirely gone.
  if grep -q 'CLICKHOUSE_LWQL_' "$out"; then
    fail "managed-clickhouse-lwql-config" \
      "the render still emits CLICKHOUSE_LWQL_* config env. Issue #8258 removes the chart's rendered LWQL access-model path entirely — the app self-provisions instead."
  fi
}

# @scenario "The application self-provisions the LangWatchQL access model on every deployment"
test_external_clickhouse_two_passwords_only() {
  local out="${TMPDIR:-/tmp}/lwql-conn-external-ch.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-external-ch.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set clickhouse.chartManaged=false \
      --set clickhouse.external.url.value="http://user:pass@ch.example:8123/langwatch"; then
    fail "external-ch-render" "external ClickHouse render failed:
$(cat "$err")"
    return
  fi

  local names
  names="$(env_names_in "$out" "app/deployment.yaml")"
  assert_two_passwords_only "$names" "app/deployment.yaml" "external-ch" "$out"
}

# @scenario "The application self-provisions the LangWatchQL access model on every deployment"
test_external_postgres_two_passwords_only() {
  local out="${TMPDIR:-/tmp}/lwql-conn-external-pg.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-external-pg.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set postgresql.chartManaged=false \
      --set postgresql.external.connectionString.value="postgresql://u:p@extpg:5432/langwatch"; then
    fail "external-pg-render" "external PostgreSQL render failed:
$(cat "$err")"
    return
  fi

  local names
  names="$(env_names_in "$out" "app/deployment.yaml")"
  assert_two_passwords_only "$names" "app/deployment.yaml" "external-pg" "$out"
}

# Verifies: lwql.enabled=false emits no LangWatchQL env at all
test_disabled_emits_nothing() {
  local out="${TMPDIR:-/tmp}/lwql-conn-disabled.yaml"
  local err="${TMPDIR:-/tmp}/lwql-conn-disabled.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set lwql.enabled=false; then
    fail "disabled-render" "render with lwql.enabled=false failed:
$(cat "$err")"
    return
  fi

  local workload names var
  for workload in "app/deployment.yaml" "workers/deployment.yaml"; do
    names="$(env_names_in "$out" "$workload")"
    for var in LWQL_CLICKHOUSE_PASSWORD LWQL_POSTGRES_READER_PASSWORD LWQL_SELF_PROVISION LWQL_MANAGE_POSTGRES_READER; do
      if has_env "$names" "$var"; then
        fail "disabled-unexpected-$workload-$var" \
          "$workload emits $var with lwql.enabled=false. Disabling the feature must emit no LWQL env at all."
      fi
    done
  done
}

# @scenario "Chart-managed ClickHouse leaves the access-model mode at its rendered default"
test_chart_managed_mode_is_rendered_default() {
  local out="${TMPDIR:-/tmp}/lwql-mode-managed.yaml"
  local err="${TMPDIR:-/tmp}/lwql-mode-managed.err"
  if ! render_to "$out" "$err" t --set autogen.enabled=true; then
    fail "managed-mode-render" "default render failed:
$(cat "$err")"
    return
  fi
  local names
  names="$(env_names_in "$out" "app/deployment.yaml")"
  if has_env "$names" "LWQL_ACCESS_MODEL_MODE"; then
    fail "managed-mode-set" \
      "app/deployment.yaml sets LWQL_ACCESS_MODEL_MODE on chart-managed ClickHouse. It must stay unset so the app renders (the chart delivers the model via the access Secret + Job), not run SQL DDL. The default when unset is 'rendered'."
  fi
}

# @scenario "The external-ClickHouse overlay selects sql mode"
test_external_overlay_selects_sql_mode() {
  local out="${TMPDIR:-/tmp}/lwql-mode-external.yaml"
  local err="${TMPDIR:-/tmp}/lwql-mode-external.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      -f examples/overlays/clickhouse-external.yaml \
      --set clickhouse.external.url.value="http://user:pass@ch.example:8123/langwatch"; then
    fail "external-mode-render" "external overlay render failed:
$(cat "$err")"
    return
  fi
  local mode single
  mode="$(env_value_in "$out" "app/deployment.yaml" "LWQL_ACCESS_MODEL_MODE")"
  if [[ "$mode" != "sql" ]]; then
    fail "external-mode-not-sql" \
      "app/deployment.yaml sets LWQL_ACCESS_MODEL_MODE=${mode:-<unset>} under the clickhouse-external overlay; BYO ClickHouse cannot receive a rendered config file, so it must be 'sql'."
  fi
  single="$(env_value_in "$out" "app/deployment.yaml" "LWQL_ACCESS_MODEL_SQL_SINGLE_NODE")"
  if [[ "$single" != "true" ]]; then
    fail "external-mode-no-single-node-ack" \
      "the clickhouse-external overlay does not acknowledge single-node scope (LWQL_ACCESS_MODEL_SQL_SINGLE_NODE=true) — AC9 aborts sql-mode provisioning on an unacknowledged single node."
  fi
}

# @scenario "The access model is delivered by one Job into one Secret, mounted once per pod"
# @scenario "A chart upgrade that changes the access model rolls every ClickHouse pod"
test_render_delivery_topology() {
  local out="${TMPDIR:-/tmp}/lwql-topology.yaml"
  local err="${TMPDIR:-/tmp}/lwql-topology.err"
  if ! render_to "$out" "$err" lw --set autogen.enabled=true; then
    fail "topology-render" "default render failed:
$(cat "$err")"
    return
  fi

  # One render Job (revision-suffixed name) that runs the app image and renders
  # the access files. It is MAIN-PHASE on install and a PRE-UPGRADE hook on
  # upgrade (asserted below): the render reads the app + PostgreSQL Secrets, which
  # exist only in the main phase, so a pre-install hook would fail on a first
  # install; on upgrade those Secrets already exist and the render must precede
  # the StatefulSet roll.
  if ! grep -qE "name: lw-lwql-access-render-[0-9]+" "$out"; then
    fail "topology-no-job" "no revision-named lw-lwql-access-render-<n> Job rendered on chart-managed ClickHouse."
  fi
  if ! grep -q "renderLwqlAccessConfig" "$out"; then
    fail "topology-no-render-cmd" "the access-render Job does not invoke renderLwqlAccessConfig."
  fi
  # Isolate the render Job document from the rendered template — it also emits the
  # ServiceAccount/Role/RoleBinding, which ARE hooks (below), so a whole-file hook
  # grep could not tell the Job apart.
  job_doc() {
    awk '/^---[[:space:]]*$/ { if (buf ~ /kind: Job/) print buf; buf=""; next }
         { buf = buf $0 "\n" }
         END { if (buf ~ /kind: Job/) print buf }' "$1"
  }
  # On INSTALL the render JOB must be MAIN-PHASE (no helm hook): a pre-install Job
  # cannot read DATABASE_URL from the main-phase PostgreSQL Secret.
  local only="${TMPDIR:-/tmp}/lwql-render-only.yaml"
  if helm template lw . --set autogen.enabled=true \
       --show-only templates/clickhouse/lwql-access-render.yaml >"$only" 2>/dev/null; then
    if job_doc "$only" | grep -q 'helm.sh/hook:'; then
      fail "topology-install-job-not-hook" "on install the render Job must be main-phase (no helm hook) so it reads DATABASE_URL from the main-phase PostgreSQL Secret on a first install."
    fi
    # The RBAC (ServiceAccount/Role/RoleBinding) MUST be
    # pre-install,pre-upgrade,pre-rollback hooks at a lower weight than the Job:
    # both they and the LWQL passwords are new in this version, so on a first
    # upgrade from a pre-LWQL release neither exists in the main phase yet when the
    # pre-upgrade hook Job runs; pre-rollback so `helm rollback`/`--atomic` also
    # has them before the pods roll.
    if [[ "$(grep -c 'helm.sh/hook: pre-install,pre-upgrade,pre-rollback' "$only")" -lt 3 ]]; then
      fail "topology-rbac-hooks" "the render ServiceAccount/Role/RoleBinding must each be pre-install,pre-upgrade,pre-rollback hooks so they back the pre-upgrade/pre-rollback hook Job."
    fi
    if ! grep -q 'helm.sh/hook-weight: "-10"' "$only"; then
      fail "topology-rbac-weight" "the render RBAC hooks must sit at a lower hook-weight (-10) than the Job so they are created first."
    fi
  fi
  # On UPGRADE (and ROLLBACK — both set .Release.IsUpgrade) the render Job MUST be
  # a pre-upgrade,pre-rollback hook: the new access Secret has to be written
  # BEFORE the StatefulSet's catalog annotation rolls the pods, or every subPath
  # mount freezes the previous release's model. Rollback reverts the annotation
  # and rolls the pods too, so it needs the same pre-hook render. The input
  # Secrets already exist on an upgrade/rollback, so the hook has what it needs.
  local upgrade_only="${TMPDIR:-/tmp}/lwql-render-upgrade-only.yaml"
  if helm template lw . --is-upgrade --set autogen.enabled=true \
       --show-only templates/clickhouse/lwql-access-render.yaml >"$upgrade_only" 2>/dev/null; then
    if ! job_doc "$upgrade_only" | grep -q 'helm.sh/hook: pre-upgrade,pre-rollback'; then
      fail "topology-upgrade-hook" "on upgrade/rollback the render Job must be a pre-upgrade,pre-rollback hook so the new access Secret lands before the StatefulSet roll."
    fi
  else
    fail "topology-upgrade-render" "the access-render template failed to render with --is-upgrade."
  fi
  # The LWQL password Secret must ALSO be a pre-install,pre-upgrade,pre-rollback
  # hook carrying both keys, so the render Job finds the passwords on a first
  # upgrade (and on rollback) before the main phase would heal the app Secret.
  local pw_only="${TMPDIR:-/tmp}/lwql-passwords-only.yaml"
  if helm template lw . --set autogen.enabled=true \
       --show-only templates/lwql-passwords-secret.yaml >"$pw_only" 2>/dev/null; then
    if ! grep -q 'helm.sh/hook: pre-install,pre-upgrade,pre-rollback' "$pw_only"; then
      fail "topology-passwords-hook" "the LWQL password Secret must be a pre-install,pre-upgrade,pre-rollback hook."
    fi
    if ! grep -q 'LWQL_CLICKHOUSE_PASSWORD:' "$pw_only" || ! grep -q 'LWQL_POSTGRES_READER_PASSWORD:' "$pw_only"; then
      fail "topology-passwords-keys" "the LWQL password Secret must carry both LWQL_CLICKHOUSE_PASSWORD and LWQL_POSTGRES_READER_PASSWORD."
    fi
  else
    fail "topology-passwords-render" "the LWQL password Secret template failed to render."
  fi
  # The Role is scoped to the one Secret name for get/update/patch (create cannot
  # be name-scoped in Kubernetes RBAC, so it is a separate namespaced rule).
  if ! grep -q 'resourceNames: \["lw-lwql-clickhouse-access"\]' "$out"; then
    fail "topology-role-scope" "the access-render Role is not resourceName-scoped to lw-lwql-clickhouse-access."
  fi

  # Every ClickHouse pod mounts the Secret at the two contract paths.
  local mount_users mount_config
  mount_users=$(grep -c "mountPath: /etc/clickhouse-server/users.d/lwql-access.yaml" "$out")
  mount_config=$(grep -c "mountPath: /etc/clickhouse-server/config.d/lwql-named-collection.yaml" "$out")
  if [[ "$mount_users" -lt 1 || "$mount_config" -lt 1 ]]; then
    fail "topology-mount" "the ClickHouse pod does not mount the access Secret at both users.d and config.d paths."
  fi
  if ! grep -q "secretName: 'lw-lwql-clickhouse-access'" "$out" \
     && ! grep -q 'secretName: lw-lwql-clickhouse-access' "$out"; then
    fail "topology-volume" "the ClickHouse pod has no volume backed by the lw-lwql-clickhouse-access Secret."
  fi

  # Upgrade refresh: the ClickHouse pod template carries the catalog-version
  # annotation that rolls the StatefulSet when the app catalog changes.
  if ! grep -q "langwatch.com/lwql-access-catalog:" "$out"; then
    fail "topology-annotation" "the ClickHouse pod template carries no langwatch.com/lwql-access-catalog annotation, so an upgrade would not re-mount a changed access Secret."
  fi
}

test_chart_managed_two_passwords_only
test_external_clickhouse_two_passwords_only
test_external_postgres_two_passwords_only
test_disabled_emits_nothing
test_chart_managed_mode_is_rendered_default
test_external_overlay_selects_sql_mode
test_render_delivery_topology

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: all LangWatchQL connection/mode/delivery postures pinned — (1) chart-managed ClickHouse emits exactly the two passwords, each a secretKeyRef, on app and workers, and no CLICKHOUSE_LWQL_* config; (2) external ClickHouse emits the same two secretKeyRef vars only; (3) external PostgreSQL emits the same two secretKeyRef vars only and renders successfully; (4) lwql.enabled=false emits no LWQL env at all; (5) chart-managed ClickHouse leaves LWQL_ACCESS_MODEL_MODE unset (rendered default); (6) the clickhouse-external overlay selects sql mode and acknowledges single-node scope; (7) chart-managed ClickHouse renders one render Job (main-phase on install, pre-upgrade,pre-rollback hook on upgrade/rollback) with its RBAC and the LWQL password Secret as pre-install,pre-upgrade,pre-rollback hooks at a lower weight, a name-scoped Role, mounts the access Secret on every pod at both paths, and carries the catalog-version roll annotation"
