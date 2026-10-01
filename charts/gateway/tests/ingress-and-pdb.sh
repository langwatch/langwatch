#!/usr/bin/env bash
#
# Renders the gateway chart and asserts two things about what a plain install
# creates on the cluster:
#
#   - the Ingress is opt-in. A default render has none, an enabled one carries
#     the class the operator picked (or none, for the cluster default), and the
#     ingress-nginx annotations appear only when that class is nginx.
#   - the PodDisruptionBudget never blocks a node drain. None renders over a
#     single pod, and a budget that leaves no pod evictable is refused.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies.
#
# Usage (from charts/gateway):
#   ./tests/ingress-and-pdb.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
tmp="${TMPDIR:-/tmp}/gateway-ingress-and-pdb.$$"
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
  helm template gw . "$@" >"$tmp/$name.yaml" 2>"$tmp/$name.err" || true
}

# The rendered document for one template file.
doc_of() {
  local name="$1" template="$2"
  awk -v want="# Source: langwatch-gateway/templates/$template" '
    $0 == want { grab=1; next }
    grab && /^---/ { exit }
    grab { print }
  ' "$tmp/$name.yaml"
}

# @scenario "a default install creates no gateway Ingress"
test_default_render_has_no_ingress() {
  render default
  if [ -s "$tmp/default.err" ]; then
    fail "default ingress" "default render failed: $(cat "$tmp/default.err")"
    return
  fi
  if grep -q '^kind: Ingress$' "$tmp/default.yaml"; then
    fail "default ingress" "a default render created an Ingress"
  else
    ok "default ingress" "no Ingress in the default render"
  fi
  if grep -q 'nginx.ingress.kubernetes.io' "$tmp/default.yaml"; then
    fail "default annotations" "a default render carries ingress-nginx annotations"
  else
    ok "default annotations" "no ingress-nginx annotations anywhere"
  fi
}

# @scenario "an enabled gateway Ingress uses the class the operator picked"
test_enabled_ingress_uses_the_chosen_class() {
  local doc
  render envoy --set ingress.enabled=true --set ingress.host=gateway.acme.com \
    --set ingress.className=envoy
  doc=$(doc_of envoy ingress.yaml)
  if [ -z "$doc" ]; then
    fail "chosen class" "no Ingress rendered: $(cat "$tmp/envoy.err")"
    return
  fi
  if printf '%s\n' "$doc" | grep -q 'ingressClassName: envoy$'; then
    ok "chosen class" "ingressClassName: envoy"
  else
    fail "chosen class" "ingressClassName is not envoy: $(printf '%s\n' "$doc" | grep ingressClassName || echo '<absent>')"
  fi
  if printf '%s\n' "$doc" | grep -q 'nginx.ingress.kubernetes.io'; then
    fail "chosen class annotations" "an envoy Ingress carries ingress-nginx annotations"
  else
    ok "chosen class annotations" "no ingress-nginx annotations on an envoy Ingress"
  fi
  if printf '%s\n' "$doc" | grep -q 'host: "gateway.acme.com"'; then
    ok "chosen class host" "rule host is gateway.acme.com"
  else
    fail "chosen class host" "rule host is not gateway.acme.com"
  fi

  render noclass --set ingress.enabled=true --set ingress.host=gateway.acme.com
  doc=$(doc_of noclass ingress.yaml)
  if [ -z "$doc" ]; then
    fail "default class" "no Ingress rendered: $(cat "$tmp/noclass.err")"
  elif printf '%s\n' "$doc" | grep -q 'ingressClassName'; then
    fail "default class" "an empty className still rendered ingressClassName"
  else
    ok "default class" "empty className leaves the cluster default IngressClass"
  fi
}

# @scenario "ingress-nginx annotations apply only to an nginx gateway Ingress"
test_nginx_annotations_follow_the_nginx_class() {
  local doc
  render nginx --set ingress.enabled=true --set ingress.host=gateway.acme.com \
    --set ingress.className=nginx \
    --set-string 'ingress.annotations.nginx\.ingress\.kubernetes\.io/proxy-read-timeout=7200'
  doc=$(doc_of nginx ingress.yaml)
  if printf '%s\n' "$doc" | grep -q 'nginx.ingress.kubernetes.io/proxy-buffering: "off"'; then
    ok "nginx streaming" "proxy-buffering off on an nginx Ingress"
  else
    fail "nginx streaming" "nginx Ingress is missing proxy-buffering off"
  fi
  if printf '%s\n' "$doc" | grep -q 'nginx.ingress.kubernetes.io/proxy-body-size: 32m'; then
    ok "nginx body size" "proxy-body-size matches the 32 MiB request cap"
  else
    fail "nginx body size" "nginx Ingress is missing proxy-body-size 32m"
  fi
  if printf '%s\n' "$doc" | grep -q 'nginx.ingress.kubernetes.io/proxy-read-timeout: "7200"'; then
    ok "nginx override" "an operator annotation wins over the nginx default"
  else
    fail "nginx override" "ingress.annotations did not override the nginx default read timeout"
  fi
}

# @scenario "a gateway host without an enabled Ingress is refused"
test_host_without_enabled_is_refused() {
  render hostonly --set ingress.host=gateway.acme.com
  if grep -q 'ingress.enabled is not true' "$tmp/hostonly.err"; then
    ok "host only" "render refused, naming ingress.enabled"
  else
    fail "host only" "a host without enabled rendered: $(cat "$tmp/hostonly.err")"
  fi
  render nohost --set ingress.enabled=true
  if grep -q 'ingress.host is empty' "$tmp/nohost.err"; then
    ok "enabled without host" "render refused, naming ingress.host"
  else
    fail "enabled without host" "enabled without a host rendered: $(cat "$tmp/nohost.err")"
  fi
}

# @scenario "the gateway PodDisruptionBudget never blocks a node drain"
test_pdb_never_blocks_a_drain() {
  local doc

  render pdb-default
  doc=$(doc_of pdb-default pdb.yaml)
  if printf '%s\n' "$doc" | grep -q 'maxUnavailable: 1$'; then
    ok "pdb default" "maxUnavailable: 1 over the 2-pod HPA floor"
  else
    fail "pdb default" "default PDB is not maxUnavailable: 1: ${doc:-<absent>}"
  fi

  render pdb-single --set autoscaling.enabled=false --set replicaCount=1
  if grep -q '^kind: PodDisruptionBudget$' "$tmp/pdb-single.yaml"; then
    fail "pdb single replica" "a PDB rendered over a single gateway pod"
  else
    ok "pdb single replica" "no PDB with replicaCount 1"
  fi

  render pdb-hpa-one --set autoscaling.minReplicas=1
  if grep -q '^kind: PodDisruptionBudget$' "$tmp/pdb-hpa-one.yaml"; then
    fail "pdb hpa floor 1" "a PDB rendered with an HPA floor of 1"
  else
    ok "pdb hpa floor 1" "no PDB with autoscaling.minReplicas 1"
  fi

  render pdb-min --set podDisruptionBudget.minAvailable=1
  doc=$(doc_of pdb-min pdb.yaml)
  if printf '%s\n' "$doc" | grep -q 'minAvailable: 1$' && ! printf '%s\n' "$doc" | grep -q maxUnavailable; then
    ok "pdb minAvailable" "minAvailable: 1 replaces maxUnavailable when set"
  else
    fail "pdb minAvailable" "minAvailable override did not render alone: ${doc:-<absent>} $(cat "$tmp/pdb-min.err")"
  fi

  render pdb-min-all --set podDisruptionBudget.minAvailable=2
  if grep -q 'no pod may ever be evicted' "$tmp/pdb-min-all.err"; then
    ok "pdb minAvailable = pods" "render refused"
  else
    fail "pdb minAvailable = pods" "minAvailable equal to the pod count rendered"
  fi

  render pdb-max-zero --set podDisruptionBudget.maxUnavailable=0
  if grep -q 'maxUnavailable must be at least 1' "$tmp/pdb-max-zero.err"; then
    ok "pdb maxUnavailable 0" "render refused"
  else
    fail "pdb maxUnavailable 0" "maxUnavailable 0 rendered"
  fi
}

test_default_render_has_no_ingress
test_enabled_ingress_uses_the_chosen_class
test_nginx_annotations_follow_the_nginx_class
test_host_without_enabled_is_refused
test_pdb_never_blocks_a_drain

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all gateway ingress and PDB assertions passed"
