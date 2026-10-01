#!/usr/bin/env bash
#
# Renders the umbrella chart and asserts what a plain install creates for
# routing and disruption budgets:
#
#   - no Ingress at all until an operator enables one. The gateway is
#     published from the app Ingress settings with ingress.gateway.host, as a
#     second Ingress object, and the retired gateway.ingress values are refused.
#   - no PodDisruptionBudget that blocks a node drain: none over a single pod,
#     and a budget that leaves no pod evictable is refused at render time.
#
# Each test that binds to a feature scenario carries a "# @scenario \"...\"" line.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/gateway-ingress-and-pdbs.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
tmp="${TMPDIR:-/tmp}/lw-gateway-ingress-and-pdbs.$$"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

ok() {
  echo "ok   [$1] $2"
}

# Renders into $tmp/<name>.yaml, errors into $tmp/<name>.err. Never fails the
# script: the caller asserts on the files.
render() {
  local name="$1"
  shift
  helm template lw . --set autogen.enabled=true "$@" >"$tmp/$name.yaml" 2>"$tmp/$name.err" || true
}

# Plain `value:` of `- name: <var>` inside the app Deployment.
app_env() {
  local name="$1" var="$2"
  awk -v v="$var" '
    /^# Source:/ { insrc = (index($0, "langwatch/templates/app/deployment.yaml") > 0); found=0 }
    insrc && $0 ~ "- name: " v "$" { found=1; next }
    insrc && /^[[:space:]]*- name:[[:space:]]/ { found=0 }
    found && /^[[:space:]]*value:[[:space:]]/ {
      sub(/^[[:space:]]*value:[[:space:]]*/, ""); gsub(/"/, ""); print; exit
    }
  ' "$tmp/$name.yaml"
}

# The rendered document for one template file.
doc_of() {
  local name="$1" source="$2"
  awk -v want="# Source: $source" '
    $0 == want { grab=1; next }
    grab && /^---/ { exit }
    grab { print }
  ' "$tmp/$name.yaml"
}

# One rendered document, picked by its metadata.name.
doc_named() {
  local name="$1" want="$2"
  awk -v want="  name: $want" '
    /^---/ { if (hit) exit; buf=""; next }
    { buf = buf $0 "\n" }
    $0 == want { hit=1 }
    END { if (hit) printf "%s", buf }
  ' "$tmp/$name.yaml"
}

# @scenario "a default install creates no gateway Ingress"
test_default_install_has_no_ingress() {
  render default
  if [ -s "$tmp/default.err" ]; then
    fail "default render" "$(cat "$tmp/default.err")"
    return
  fi
  if grep -q '^kind: Ingress$' "$tmp/default.yaml"; then
    fail "default ingress" "a default install renders an Ingress: $(grep -A3 '^kind: Ingress$' "$tmp/default.yaml" | grep name: | head -2 | tr '\n' ' ')"
  else
    ok "default ingress" "no Ingress in a default install"
  fi
  if grep -q 'nginx.ingress.kubernetes.io' "$tmp/default.yaml"; then
    fail "default annotations" "a default install carries ingress-nginx annotations"
  else
    ok "default annotations" "no ingress-nginx annotations in a default install"
  fi
  if [ -n "$(app_env default LW_GATEWAY_PUBLIC_URL)" ]; then
    fail "default public url" "LW_GATEWAY_PUBLIC_URL is set with no gateway route: $(app_env default LW_GATEWAY_PUBLIC_URL)"
  else
    ok "default public url" "no LW_GATEWAY_PUBLIC_URL without a gateway route"
  fi
}

# Common flags: the app Ingress on, with a gateway host.
APP_INGRESS=(--set ingress.enabled=true --set 'ingress.hosts[0].host=langwatch.acme.com'
  --set 'ingress.hosts[0].http.paths[0].path=/' --set 'ingress.hosts[0].http.paths[0].pathType=Prefix'
  --set ingress.gateway.host=gateway.acme.com)

# @scenario "the gateway host follows the app Ingress settings"
test_gateway_host_on_the_app_ingress() {
  local doc url
  render envoy "${APP_INGRESS[@]}" --set ingress.className=envoy \
    --set-string 'ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod' \
    --set ingress.gateway.tls.secretName=gateway-tls
  doc=$(doc_named envoy lw-gateway-ingress)
  if [ -z "$doc" ]; then
    fail "gateway ingress" "no lw-gateway-ingress rendered: $(cat "$tmp/envoy.err")"
    return
  fi
  if printf '%s\n' "$doc" | grep -q 'ingressClassName: envoy$'; then
    ok "gateway class" "ingressClassName: envoy, from ingress.className"
  else
    fail "gateway class" "the gateway Ingress did not take ingress.className"
  fi
  if printf '%s\n' "$doc" | grep -q 'cert-manager.io/cluster-issuer: letsencrypt-prod'; then
    ok "gateway annotations" "carries the app Ingress annotations"
  else
    fail "gateway annotations" "the app Ingress annotations did not reach the gateway Ingress"
  fi
  if printf '%s\n' "$doc" | grep -q 'nginx.ingress.kubernetes.io'; then
    fail "gateway no nginx" "an envoy gateway Ingress carries ingress-nginx annotations"
  else
    ok "gateway no nginx" "no ingress-nginx annotations on an envoy class"
  fi
  if [ "$(printf '%s\n' "$doc" | grep -A2 'service:$' | grep -c 'name: lw-gateway$')" = "2" ] && printf '%s\n' "$doc" | grep -q 'path: /v1$' \
      && printf '%s\n' "$doc" | grep -q 'path: /health$'; then
    ok "gateway backend" "/v1 and /health route to the lw-gateway Service"
  else
    fail "gateway backend" "the gateway paths do not route to lw-gateway"
  fi
  if printf '%s\n' "$doc" | grep -q 'secretName: gateway-tls$'; then
    ok "gateway tls" "tls uses ingress.gateway.tls.secretName"
  else
    fail "gateway tls" "the gateway tls secret is missing"
  fi
  url=$(app_env envoy LW_GATEWAY_PUBLIC_URL)
  if [ "$url" = "https://gateway.acme.com" ]; then
    ok "gateway public url" "LW_GATEWAY_PUBLIC_URL derived from ingress.gateway.host"
  else
    fail "gateway public url" "LW_GATEWAY_PUBLIC_URL is '${url:-<unset>}', want https://gateway.acme.com"
  fi

  render nogw "${APP_INGRESS[@]/ingress.gateway.host=gateway.acme.com/ingress.gateway.host=}"
  if grep -q 'lw-gateway-ingress' "$tmp/nogw.yaml"; then
    fail "no gateway host" "a gateway Ingress rendered with no ingress.gateway.host"
  else
    ok "no gateway host" "no gateway Ingress without ingress.gateway.host"
  fi
}

# @scenario "ingress-nginx streaming settings apply only to an nginx gateway host"
test_nginx_settings_on_the_gateway_host() {
  local doc app
  render nginx "${APP_INGRESS[@]}" --set ingress.className=nginx \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/proxy-read-timeout=120' \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/rewrite-target=/$2' \
    --set-string 'ingress.gateway.annotations.nginx\.ingress\.kubernetes\.io/proxy-send-timeout=7200'
  doc=$(doc_named nginx lw-gateway-ingress)
  app=$(doc_named nginx lw-ingress)
  if printf '%s\n' "$doc" | grep -q 'rewrite-target'; then
    fail "nginx gateway rewrite" "the gateway Ingress inherited the app rewrite-target, which sends /v1/... to /"
  elif printf '%s\n' "$app" | grep -q 'rewrite-target'; then
    ok "nginx gateway rewrite" "the app rewrite-target stays on the app Ingress"
  else
    fail "nginx gateway rewrite" "the app Ingress lost its rewrite-target"
  fi
  if printf '%s\n' "$doc" | grep -q 'proxy-buffering: "off"' && printf '%s\n' "$doc" | grep -q 'proxy-body-size: 32m' \
      && printf '%s\n' "$doc" | grep -q 'proxy-read-timeout: "3600"'; then
    ok "nginx gateway" "buffering off, 32m body, 3600s read timeout on the gateway Ingress"
  else
    fail "nginx gateway" "the gateway Ingress is missing the nginx streaming settings"
  fi
  if printf '%s\n' "$doc" | grep -q 'proxy-send-timeout: "7200"'; then
    ok "nginx gateway override" "ingress.gateway.annotations wins"
  else
    fail "nginx gateway override" "ingress.gateway.annotations did not override the nginx default"
  fi
  if printf '%s\n' "$app" | grep -q 'proxy-buffering'; then
    fail "nginx app untouched" "the app Ingress picked up the gateway streaming settings"
  elif printf '%s\n' "$app" | grep -q 'proxy-read-timeout: "120"'; then
    ok "nginx app untouched" "the app Ingress keeps its own annotations"
  else
    fail "nginx app untouched" "the app Ingress lost its annotations"
  fi
}

# @scenario "a gateway host without an enabled Ingress is refused"
test_gateway_host_without_ingress_is_refused() {
  render hostonly --set ingress.gateway.host=gateway.acme.com
  if grep -q 'ingress.enabled is not true' "$tmp/hostonly.err"; then
    ok "gateway host only" "render refused, naming ingress.enabled"
  else
    fail "gateway host only" "ingress.gateway.host without ingress.enabled rendered"
  fi
}

# @scenario "a gateway host without a gateway in the release is refused"
test_gateway_host_without_gateway_is_refused() {
  render nogateway "${APP_INGRESS[@]}" --set gateway.chartManaged=false
  if grep -q 'gateway.chartManaged is false' "$tmp/nogateway.err"; then
    ok "gateway host without gateway" "render refused, naming gateway.chartManaged"
  else
    fail "gateway host without gateway" "ingress.gateway.host with gateway.chartManaged=false rendered: $(cat "$tmp/nogateway.err")"
  fi
}

# @scenario "retired gateway ingress values are refused"
test_retired_gateway_ingress_values_are_refused() {
  local entry
  for entry in "gateway.ingress.enabled=true" "gateway.ingress.host=gateway.acme.com"; do
    render "retired-${entry%%=*}" --set "$entry"
    if grep -q 'ingress.gateway.host' "$tmp/retired-${entry%%=*}.err"; then
      ok "retired $entry" "render refused, naming ingress.gateway.host"
    else
      fail "retired $entry" "rendered or failed without naming the new key: $(cat "$tmp/retired-${entry%%=*}.err")"
    fi
  done
  render retired-off --set gateway.ingress.enabled=false
  if [ -s "$tmp/retired-off.err" ]; then
    fail "gateway.ingress.enabled=false" "an explicit off switch was refused: $(cat "$tmp/retired-off.err")"
  else
    ok "gateway.ingress.enabled=false" "an explicit off switch still renders"
  fi
}

# @scenario "the gateway PodDisruptionBudget never blocks a node drain"
test_gateway_pdb_under_the_umbrella() {
  local doc
  render gw-pdb
  doc=$(doc_of gw-pdb langwatch/charts/gateway/templates/pdb.yaml)
  if printf '%s\n' "$doc" | grep -q 'maxUnavailable: 1$'; then
    ok "umbrella gateway pdb" "gateway PDB is maxUnavailable: 1"
  else
    fail "umbrella gateway pdb" "gateway PDB is not maxUnavailable: 1: ${doc:-<absent>}"
  fi
  render gw-pdb-single --set gateway.autoscaling.enabled=false --set gateway.replicaCount=1
  if [ -s "$tmp/gw-pdb-single.err" ] || ! grep -q '# Source: langwatch/charts/gateway/templates/deployment.yaml' "$tmp/gw-pdb-single.yaml"; then
    fail "umbrella gateway pdb single" "the single-replica render failed: $(cat "$tmp/gw-pdb-single.err")"
  elif [ -n "$(doc_of gw-pdb-single langwatch/charts/gateway/templates/pdb.yaml)" ]; then
    fail "umbrella gateway pdb single" "a gateway PDB rendered over one pod"
  else
    ok "umbrella gateway pdb single" "no gateway PDB over one pod"
  fi
}

# @scenario "a PodDisruptionBudget over a single pod is not rendered"
test_pass_through_pdb_over_one_pod_is_skipped() {
  local component
  for component in app workers langwatch_nlp langevals; do
    render "single-$component" --set "$component.podDisruptionBudget.minAvailable=1"
    if [ -s "$tmp/single-$component.err" ]; then
      fail "single $component" "render failed: $(cat "$tmp/single-$component.err")"
    elif grep -q "# Source: langwatch/templates/$component/pdb.yaml" "$tmp/single-$component.yaml"; then
      fail "single $component" "a $component PDB rendered over one pod"
    else
      ok "single $component" "no $component PDB at replicaCount 1"
    fi
  done
  render app-two --set app.replicaCount=2 --set app.storedObjects.localFilesystem.enabled=false \
    --set app.podDisruptionBudget.maxUnavailable=1
  if grep -q '# Source: langwatch/templates/app/pdb.yaml' "$tmp/app-two.yaml"; then
    ok "app pdb two pods" "app PDB renders at replicaCount 2"
  else
    fail "app pdb two pods" "app PDB missing at replicaCount 2: $(cat "$tmp/app-two.err")"
  fi
}

# @scenario "a PodDisruptionBudget that leaves no pod evictable is refused"
test_blocking_pass_through_pdb_is_refused() {
  render app-min-all --set app.replicaCount=2 --set app.storedObjects.localFilesystem.enabled=false \
    --set app.podDisruptionBudget.minAvailable=2
  if grep -q 'app.podDisruptionBudget.minAvailable is 2 with replicaCount 2' "$tmp/app-min-all.err"; then
    ok "app minAvailable = pods" "render refused"
  else
    fail "app minAvailable = pods" "minAvailable equal to replicaCount rendered: $(cat "$tmp/app-min-all.err")"
  fi
  render workers-max-zero --set workers.replicaCount=3 --set app.storedObjects.localFilesystem.enabled=false \
    --set workers.podDisruptionBudget.maxUnavailable=0
  if grep -q 'workers.podDisruptionBudget.maxUnavailable is 0' "$tmp/workers-max-zero.err"; then
    ok "workers maxUnavailable 0" "render refused"
  else
    fail "workers maxUnavailable 0" "maxUnavailable 0 rendered: $(cat "$tmp/workers-max-zero.err")"
  fi
  render nlp-percent --set langwatch_nlp.replicaCount=2 \
    --set-string 'langwatch_nlp.podDisruptionBudget.minAvailable=100%'
  if grep -q 'langwatch_nlp.podDisruptionBudget.minAvailable is 100%' "$tmp/nlp-percent.err"; then
    ok "nlp minAvailable 100%" "render refused"
  else
    fail "nlp minAvailable 100%" "minAvailable 100% rendered: $(cat "$tmp/nlp-percent.err")"
  fi
  render app-pct --set app.replicaCount=2 --set app.storedObjects.localFilesystem.enabled=false \
    --set-string 'app.podDisruptionBudget.minAvailable=75%'
  if grep -q 'app.podDisruptionBudget.minAvailable is 75%' "$tmp/app-pct.err"; then
    ok "app minAvailable 75%" "render refused (75% of 2 rounds up to 2)"
  else
    fail "app minAvailable 75%" "minAvailable 75% of 2 pods rendered: $(cat "$tmp/app-pct.err")"
  fi
  render workers-pct --set workers.replicaCount=3 --set app.storedObjects.localFilesystem.enabled=false \
    --set-string 'workers.podDisruptionBudget.maxUnavailable=0%'
  if grep -q 'workers.podDisruptionBudget.maxUnavailable is 0%' "$tmp/workers-pct.err"; then
    ok "workers maxUnavailable 0%" "render refused"
  else
    fail "workers maxUnavailable 0%" "maxUnavailable 0% rendered: $(cat "$tmp/workers-pct.err")"
  fi
}

# @scenario "in-cluster Redis stops on SIGTERM instead of waiting out its grace period"
test_redis_receives_sigterm() {
  render redis
  local doc
  doc=$(doc_of redis langwatch/templates/redis/statefulset.yaml)
  if grep -q 'command: \["sh", "-c", "exec redis-server ' <<<"$doc"; then
    ok "redis shutdown" "redis-server is exec'd, so SIGTERM reaches it"
  else
    fail "redis shutdown" "redis-server runs behind a shell, so SIGTERM may never reach it and every restart waits out the grace period"
  fi
}

test_default_install_has_no_ingress
test_gateway_host_on_the_app_ingress
test_nginx_settings_on_the_gateway_host
test_gateway_host_without_ingress_is_refused
test_gateway_host_without_gateway_is_refused
test_retired_gateway_ingress_values_are_refused
test_gateway_pdb_under_the_umbrella
test_pass_through_pdb_over_one_pod_is_skipped
test_blocking_pass_through_pdb_is_refused
test_redis_receives_sigterm

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all ingress and PodDisruptionBudget assertions passed"
