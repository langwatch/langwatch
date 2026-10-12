#!/usr/bin/env bash
#
# Renders the gateway chart and asserts two things about what it creates on
# the cluster:
#
#   - no Ingress. The langwatch chart publishes the gateway from its app
#     Ingress (ingress.gateway.host), so the retired ingress values here are
#     refused with a pointer to that key instead of being dropped.
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

# @scenario "retired gateway ingress values are refused"
test_retired_ingress_values_are_refused() {
  local entry
  for entry in "ingress.enabled=true" "ingress.host=gateway.acme.com" "ingress.className=nginx"; do
    render "retired-${entry%%=*}" --set "$entry"
    if grep -q 'ingress.gateway.host' "$tmp/retired-${entry%%=*}.err"; then
      ok "retired $entry" "render refused, naming ingress.gateway.host"
    else
      fail "retired $entry" "the retired value rendered or failed without naming the new key: $(cat "$tmp/retired-${entry%%=*}.err")"
    fi
  done
  render disabled-only --set ingress.enabled=false
  if [ -s "$tmp/disabled-only.err" ]; then
    fail "ingress.enabled=false" "an explicit off switch was refused: $(cat "$tmp/disabled-only.err")"
  else
    ok "ingress.enabled=false" "an explicit off switch still renders"
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
  if [ -s "$tmp/pdb-single.err" ] || ! grep -q '^kind: Deployment$' "$tmp/pdb-single.yaml"; then
    fail "pdb single replica" "the single-replica render failed: $(cat "$tmp/pdb-single.err")"
  elif grep -q '^kind: PodDisruptionBudget$' "$tmp/pdb-single.yaml"; then
    fail "pdb single replica" "a PDB rendered over a single gateway pod"
  else
    ok "pdb single replica" "no PDB with replicaCount 1"
  fi

  render pdb-hpa-one --set autoscaling.minReplicas=1
  if [ -s "$tmp/pdb-hpa-one.err" ] || ! grep -q '^kind: Deployment$' "$tmp/pdb-hpa-one.yaml"; then
    fail "pdb hpa floor 1" "the HPA floor 1 render failed: $(cat "$tmp/pdb-hpa-one.err")"
  elif grep -q '^kind: PodDisruptionBudget$' "$tmp/pdb-hpa-one.yaml"; then
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

  local entry
  for entry in "minAvailable=100%" "minAvailable=75%" "maxUnavailable=0%"; do
    render "pdb-pct-${entry%%=*}" --set-string "podDisruptionBudget.$entry"
    if grep -q 'no pod may ever be evicted' "$tmp/pdb-pct-${entry%%=*}.err"; then
      ok "pdb $entry" "render refused (75% of 2 pods rounds up to 2)"
    else
      fail "pdb $entry" "a percentage budget with no evictable pod rendered"
    fi
  done
  render pdb-pct-ok --set-string podDisruptionBudget.minAvailable=50%
  if grep -q 'minAvailable: 50%' "$tmp/pdb-pct-ok.yaml"; then
    ok "pdb minAvailable=50%" "an evictable percentage renders"
  else
    fail "pdb minAvailable=50%" "50% of 2 pods was refused: $(cat "$tmp/pdb-pct-ok.err")"
  fi

  render pdb-max-zero --set podDisruptionBudget.maxUnavailable=0
  if grep -q 'no pod may ever be evicted' "$tmp/pdb-max-zero.err"; then
    ok "pdb maxUnavailable 0" "render refused"
  else
    fail "pdb maxUnavailable 0" "maxUnavailable 0 rendered"
  fi
}

test_default_render_has_no_ingress
test_retired_ingress_values_are_refused
test_pdb_never_blocks_a_drain

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all gateway ingress and PDB assertions passed"
