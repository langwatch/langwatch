#!/usr/bin/env bash
#
# Renders the umbrella chart the way Argo CD does (no cluster access, every
# render a fresh revision 1) with autogen off and every Secret owned by the
# operator, and asserts the install converges and stays in sync:
#
#   - the render needs no cluster access and is byte-identical every time, so
#     no generated credential rotates on a sync;
#   - chart-managed Redis and PostgreSQL refuse to generate a password when
#     autogen is off;
#   - remapped key names reach every consumer of the app Secret;
#   - the LangWatchQL render Job is named by its spec, not by the revision;
#   - missing LangWatchQL passwords never leave ClickHouse waiting;
#   - every StatefulSet claim template names its apiVersion and kind.
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/autogen-off-and-argocd.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
tmp="${TMPDIR:-/tmp}/lw-autogen-off-and-argocd.$$"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

OFF=(-f tests/values-autogen-off.yaml)

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

ok() {
  echo "ok   [$1] $2"
}

# Renders into $tmp/<name>.yaml, errors into $tmp/<name>.err, and returns
# helm's exit status so a caller can require success.
render() {
  local name="$1"
  shift
  helm template lw . "$@" >"$tmp/$name.yaml" 2>"$tmp/$name.err"
}

# `key:` of the secretKeyRef under `- name: <var>` in one template's output.
env_key() {
  local name="$1" source="$2" var="$3"
  awk -v src="# Source: $source" -v v="$var" '
    /^# Source:/ { insrc = ($0 == src); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && found && /^[[:space:]]*- name:[[:space:]]/ { found=0 }
    insrc && found && /^[[:space:]]*key:[[:space:]]/ {
      sub(/^[[:space:]]*key:[[:space:]]*/, ""); print; exit
    }
  ' "$tmp/$name.yaml"
}

# Name of the LangWatchQL render Job.
render_job_name() {
  awk '
    /^---/ { kind=""; next }
    /^kind: Job$/ { kind="Job"; next }
    kind == "Job" && /^  name: lw-lwql-access-render-/ { sub(/^  name: /, ""); print; exit }
  ' "$tmp/$1.yaml"
}

# @scenario "an autogen-off install renders the same manifests on every sync"
test_autogen_off_render_is_stable() {
  if ! render off1 "${OFF[@]}"; then
    fail "stable render" "autogen-off render with operator Secrets failed: $(cat "$tmp/off1.err")"
    return
  fi
  render off2 "${OFF[@]}" || true
  if ! cmp -s "$tmp/off1.yaml" "$tmp/off2.yaml"; then
    fail "stable render" "two renders of the same values differ, so Argo CD would rotate a value on every sync"
    return
  fi
  local secrets
  secrets=$(grep -c '^kind: Secret$' "$tmp/off1.yaml" || true)
  if [[ "$secrets" != "0" ]]; then
    fail "stable render" "autogen off with operator Secrets still renders $secrets chart Secret(s)"
    return
  fi
  ok "stable render" "renders without cluster access, byte-identical twice, no chart Secret"
}

# @scenario "chart-managed Redis and PostgreSQL never generate a password with autogen off"
test_db_passwords_need_a_secret() {
  if render noredis "${OFF[@]}" --set redis.auth.existingSecret=""; then
    fail "redis password" "autogen off without redis.auth.existingSecret rendered a generated Redis password"
  elif grep -q 'redis.auth.existingSecret is required when autogen.enabled=false' "$tmp/noredis.err"; then
    ok "redis password" "refused, naming redis.auth.existingSecret"
  else
    fail "redis password" "render failed for another reason: $(cat "$tmp/noredis.err")"
  fi

  if render nopg "${OFF[@]}" --set postgresql.auth.existingSecret=""; then
    fail "postgresql password" "autogen off without postgresql.auth.existingSecret rendered a generated PostgreSQL password"
  elif grep -q 'postgresql.auth.existingSecret is required when autogen.enabled=false' "$tmp/nopg.err"; then
    ok "postgresql password" "refused, naming postgresql.auth.existingSecret"
  else
    fail "postgresql password" "render failed for another reason: $(cat "$tmp/nopg.err")"
  fi

  if ! render redisvalue "${OFF[@]}" --set redis.auth.existingSecret="" --set redis.auth.password=from-values; then
    fail "redis password value" "an explicit redis.auth.password was refused: $(cat "$tmp/redisvalue.err")"
  else
    ok "redis password value" "an explicit password still renders"
  fi

  if ! render autogenon --set autogen.enabled=true; then
    fail "autogen on" "autogen.enabled=true no longer renders: $(cat "$tmp/autogenon.err")"
  elif ! grep -q '^  redis-password: ' "$tmp/autogenon.yaml"; then
    fail "autogen on" "autogen.enabled=true no longer generates the Redis password"
  else
    ok "autogen on" "autogen.enabled=true still generates the Redis and PostgreSQL passwords"
  fi
}

# @scenario "remapped Secret key names reach every consumer"
test_key_names_are_remappable() {
  if ! render keys "${OFF[@]}"; then
    fail "key names" "render failed: $(cat "$tmp/keys.err")"
    return
  fi
  local app=langwatch/templates/app/deployment.yaml gw=langwatch/charts/gateway/templates/deployment.yaml
  local want got
  for pair in \
    "$app LW_GATEWAY_INTERNAL_SECRET gateway-internal-secret" \
    "$app LW_GATEWAY_JWT_SECRET gateway-jwt-secret" \
    "$gw LW_GATEWAY_INTERNAL_SECRET gateway-internal-secret" \
    "$gw LW_GATEWAY_JWT_SECRET gateway-jwt-secret" \
    "$app LWQL_CLICKHOUSE_PASSWORD lwql-clickhouse-password" \
    "$app LWQL_POSTGRES_READER_PASSWORD lwql-postgres-reader-password" \
    "$app CREDENTIALS_SECRET credentials-encryption-key" \
    "$app LANGY_INTERNAL_SECRET langy-internal-secret"; do
    read -r src var want <<<"$pair"
    got=$(env_key keys "$src" "$var")
    if [[ "$got" == "$want" ]]; then
      ok "key names" "${src%%/templates/*} $var reads key $want"
    else
      fail "key names" "$src $var reads key '$got', want '$want'"
    fi
  done

  # Autogen writes the gateway values under the configured names too, so the
  # gateway pod finds them in the chart's own Secret.
  render keysautogen --set autogen.enabled=true \
    --set gateway.secrets.internalSecretKey=gateway-internal-secret \
    --set gateway.secrets.jwtSecretKey=gateway-jwt-secret || true
  if grep -q '^  gateway-internal-secret: ' "$tmp/keysautogen.yaml" \
    && grep -q '^  gateway-jwt-secret: ' "$tmp/keysautogen.yaml" \
    && ! grep -q '^  LW_GATEWAY_INTERNAL_SECRET: ' "$tmp/keysautogen.yaml"; then
    ok "key names" "autogen writes the gateway values under the configured key names"
  else
    fail "key names" "autogen did not write the gateway values under the configured key names: $(head -3 "$tmp/keysautogen.err")"
  fi
}

# @scenario "the LangWatchQL render Job is named by its spec"
test_render_job_is_named_by_spec() {
  render job1 "${OFF[@]}" || true
  render job2 "${OFF[@]}" || true
  render jobtag "${OFF[@]}" --set images.app.tag=9.9.9 || true
  render jobup "${OFF[@]}" --is-upgrade || true
  local n1 n2 ntag nup
  n1=$(render_job_name job1)
  n2=$(render_job_name job2)
  ntag=$(render_job_name jobtag)
  nup=$(render_job_name jobup)
  if [[ -z "$n1" ]]; then
    fail "render job name" "no render Job in the output: $(head -3 "$tmp/job1.err")"
    return
  fi
  if [[ "$n1" != "$n2" ]]; then
    fail "render job name" "two renders of the same values name the Job differently ($n1, $n2)"
  else
    ok "render job name" "same spec, same name ($n1)"
  fi
  if [[ "$n1" == "$ntag" ]]; then
    fail "render job name" "a new app image keeps the Job name $n1, so the sync hits an immutable pod template"
  else
    ok "render job name" "a new app image gets a new name ($ntag)"
  fi
  if [[ "$n1" == "$nup" ]]; then
    fail "render job name" "the install Job and the upgrade hook share the name $n1"
  else
    ok "render job name" "the upgrade hook has its own name ($nup)"
  fi
  local install_doc
  install_doc=$(awk '
    function emit() { if (buf ~ /\nkind: Job\n/ && buf ~ /name: lw-lwql-access-render-/) print buf }
    /^---/ { emit(); buf=""; next }
    { buf = buf $0 "\n" }
    END { emit() }
  ' "$tmp/job1.yaml")
  if grep -q 'ttlSecondsAfterFinished' <<<"$install_doc"; then
    fail "render job ttl" "the main-phase render Job expires, so Argo CD recreates it after every TTL"
  else
    ok "render job ttl" "the main-phase render Job does not expire"
  fi
  if grep -q 'ttlSecondsAfterFinished: 600' "$tmp/jobup.yaml"; then
    ok "render job ttl" "the upgrade hook still expires"
  else
    fail "render job ttl" "the upgrade hook lost its TTL, so hook Jobs would pile up"
  fi
}

# Writes the render Job's shell script, from the rendered manifest, with its
# absolute paths moved under $tmp/run.
extract_render_script() {
  local name="$1"
  awk '
    /^---/ { injob=0; inargs=0 }
    /^kind: Job$/ { injob=1 }
    injob && /^[[:space:]]*args:[[:space:]]*$/ { seenargs=1; next }
    injob && seenargs && !inargs && /^[[:space:]]*- \|[[:space:]]*$/ {
      inargs=1; match($0, /^[[:space:]]*/); indent=RLENGTH + 2; next
    }
    inargs {
      if ($0 ~ /^[[:space:]]*$/) { print ""; next }
      match($0, /^[[:space:]]*/)
      if (RLENGTH < indent) { inargs=0; seenargs=0; next }
      print substr($0, indent + 1)
    }
  ' "$tmp/$name.yaml" \
    | sed -e "s#/render#$tmp/run/render#g" \
          -e "s#/tmp/write-secret.mjs#$tmp/run/write-secret.mjs#g" \
          -e "s#cd /app/platform/app#:#"
}

# Runs the extracted script with stand-ins for pnpm (the renderer, which fails
# without its passwords, as the real one does) and node (the Secret writer).
run_render_script() {
  local script="$1"
  shift
  rm -rf "$tmp/run"
  mkdir -p "$tmp/run/bin"
  printf '#!/bin/sh\necho pnpm >>"%s/run/calls"\n[ -n "${LWQL_CLICKHOUSE_PASSWORD:-}" ] && [ -n "${LWQL_POSTGRES_READER_PASSWORD:-}" ] || { echo "renderLwqlAccessConfig: missing required input" >&2; exit 1; }\n' "$tmp" >"$tmp/run/bin/pnpm"
  printf '#!/bin/sh\necho node >>"%s/run/calls"\n' "$tmp" >"$tmp/run/bin/node"
  chmod +x "$tmp/run/bin/pnpm" "$tmp/run/bin/node"
  env -i PATH="$tmp/run/bin:/usr/bin:/bin" LWQL_RENDER_SECRET_NAME=lw-lwql-clickhouse-access \
    LWQL_PASSWORD_SECRET=acme-app LWQL_CLICKHOUSE_PASSWORD_KEY=lwql-clickhouse-password \
    LWQL_POSTGRES_READER_PASSWORD_KEY=lwql-postgres-reader-password "$@" \
    sh "$script" >"$tmp/run/out" 2>"$tmp/run/err"
}

# @scenario "missing LangWatchQL passwords never leave ClickHouse waiting"
test_missing_lwql_passwords_do_not_block_clickhouse() {
  render script "${OFF[@]}" || true
  extract_render_script script >"$tmp/render.sh"
  if ! grep -q 'set -eu' "$tmp/render.sh"; then
    fail "lwql passwords" "could not extract the render Job script"
    return
  fi

  if run_render_script "$tmp/render.sh" LWQL_ENABLED=true; then
    if grep -q '^{}$' "$tmp/run/render/users.d/lwql-access.yaml" 2>/dev/null \
      && grep -q '^{}$' "$tmp/run/render/config.d/lwql-named-collection.yaml" 2>/dev/null \
      && grep -q 'node' "$tmp/run/calls"; then
      ok "lwql passwords" "without the passwords the Job writes an empty access model and succeeds"
    else
      fail "lwql passwords" "the Job succeeded but did not write the empty access Secret"
    fi
    if grep -q 'acme-app' "$tmp/run/err" && grep -q 'lwql-clickhouse-password' "$tmp/run/err"; then
      ok "lwql passwords" "the log names the Secret and the missing keys"
    else
      fail "lwql passwords" "the log does not name the Secret and keys: $(cat "$tmp/run/err")"
    fi
  else
    fail "lwql passwords" "the render Job fails without the LangWatchQL passwords, so ClickHouse waits on its Secret forever: $(cat "$tmp/run/err")"
  fi

  if run_render_script "$tmp/render.sh" LWQL_ENABLED=true \
    LWQL_CLICKHOUSE_PASSWORD=a LWQL_POSTGRES_READER_PASSWORD=b \
    && grep -q pnpm "$tmp/run/calls"; then
    ok "lwql passwords" "with both passwords the Job runs the renderer"
  else
    fail "lwql passwords" "with both passwords the Job did not run the renderer: $(cat "$tmp/run/err")"
  fi
}

# @scenario "StatefulSet claim templates match what the API server stores"
test_claim_templates_name_api_version_and_kind() {
  if ! render sts "${OFF[@]}" --set clickhouse.replicas=3; then
    fail "claim templates" "render failed: $(cat "$tmp/sts.err")"
    return
  fi
  local report
  report=$(awk '
    /^# Source:/ { src=$3 }
    /^kind: StatefulSet$/ { sts=src }
    /^---/ { sts=""; invct=0 }
    sts != "" && /^  volumeClaimTemplates:/ { invct=1; next }
    invct && /^  [^ ]/ { invct=0 }
    invct && /^    - / {
      total[sts]++
      if ($0 ~ /^    - apiVersion: v1$/) good[sts]++
    }
    invct && /^      kind: PersistentVolumeClaim$/ { kinds[sts]++ }
    END {
      for (s in total) print s, total[s], good[s] + 0, kinds[s] + 0
    }
  ' "$tmp/sts.yaml" | sort)
  local count=0
  while read -r src total good kinds; do
    [[ -z "$src" ]] && continue
    count=$((count + 1))
    if [[ "$total" == "$good" && "$total" == "$kinds" ]]; then
      ok "claim templates" "$src: $total claim template(s) with apiVersion and kind"
    else
      fail "claim templates" "$src: $total claim template(s), $good with apiVersion v1, $kinds with kind PersistentVolumeClaim"
    fi
  done <<<"$report"
  if [[ "$count" -lt 4 ]]; then
    fail "claim templates" "expected the PostgreSQL, Redis, ClickHouse and Keeper StatefulSets, found $count: $report"
  fi
}

test_autogen_off_render_is_stable
test_db_passwords_need_a_secret
test_key_names_are_remappable
test_render_job_is_named_by_spec
test_missing_lwql_passwords_do_not_block_clickhouse
test_claim_templates_name_api_version_and_kind

if [[ "$failures" -gt 0 ]]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all autogen-off and Argo CD assertions passed"
