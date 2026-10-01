#!/usr/bin/env bash
#
# Renders the umbrella chart and asserts what a plain install creates for
# routing and disruption budgets:
#
#   - no Ingress at all, app or gateway, until an operator enables one, and
#     an enabled gateway Ingress uses the class the operator picked and hands
#     the control plane its public URL.
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

# @scenario "an enabled gateway Ingress uses the class the operator picked"
test_enabled_gateway_ingress_under_the_umbrella() {
  local doc url
  render envoy --set gateway.ingress.enabled=true --set gateway.ingress.host=gateway.acme.com \
    --set gateway.ingress.className=envoy --set gateway.ingress.tls.enabled=true
  doc=$(doc_of envoy langwatch/charts/gateway/templates/ingress.yaml)
  if [ -z "$doc" ]; then
    fail "umbrella gateway ingress" "no gateway Ingress rendered: $(cat "$tmp/envoy.err")"
    return
  fi
  if printf '%s\n' "$doc" | grep -q 'ingressClassName: envoy$'; then
    ok "umbrella gateway class" "ingressClassName: envoy"
  else
    fail "umbrella gateway class" "ingressClassName is not envoy"
  fi
  if printf '%s\n' "$doc" | grep -q 'name: lw-gateway$'; then
    ok "umbrella gateway backend" "backend is the lw-gateway Service"
  else
    fail "umbrella gateway backend" "backend is not the lw-gateway Service"
  fi
  url=$(app_env envoy LW_GATEWAY_PUBLIC_URL)
  if [ "$url" = "https://gateway.acme.com" ]; then
    ok "umbrella public url" "LW_GATEWAY_PUBLIC_URL derived from the gateway Ingress host"
  else
    fail "umbrella public url" "LW_GATEWAY_PUBLIC_URL is '${url:-<unset>}', want https://gateway.acme.com"
  fi
}

# @scenario "a gateway host without an enabled Ingress is refused"
test_gateway_host_without_enabled_is_refused() {
  render hostonly --set gateway.ingress.host=gateway.acme.com
  if grep -q 'ingress.enabled is not true' "$tmp/hostonly.err"; then
    ok "umbrella host only" "render refused, naming ingress.enabled"
  else
    fail "umbrella host only" "gateway.ingress.host without enabled rendered"
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
  if [ -n "$(doc_of gw-pdb-single langwatch/charts/gateway/templates/pdb.yaml)" ]; then
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
  if grep -q 'langwatch_nlp.podDisruptionBudget.minAvailable is "100%"' "$tmp/nlp-percent.err"; then
    ok "nlp minAvailable 100%" "render refused"
  else
    fail "nlp minAvailable 100%" "minAvailable 100% rendered: $(cat "$tmp/nlp-percent.err")"
  fi
}

test_default_install_has_no_ingress
test_enabled_gateway_ingress_under_the_umbrella
test_gateway_host_without_enabled_is_refused
test_gateway_pdb_under_the_umbrella
test_pass_through_pdb_over_one_pod_is_skipped
test_blocking_pass_through_pdb_is_refused

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all ingress and PodDisruptionBudget assertions passed"
