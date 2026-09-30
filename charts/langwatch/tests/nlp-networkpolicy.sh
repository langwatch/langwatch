#!/usr/bin/env bash
#
# Renders the chart and asserts the nlp NetworkPolicy and the shared
# NLPGO_INTERNAL_SECRET wiring: policy present only when enabled, aimed at the
# nlp pods, admitting the app and workers, and the same Secret key read by the
# app, workers and nlp Deployments.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/nlp-networkpolicy.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0
fail() { echo "FAIL [$1] $2" >&2; failures=$((failures + 1)); }
ok() { echo "ok   [$1]"; }

render() { helm template lw . --set autogen.enabled=true "$@" 2>&1; }

# Prints the YAML document (between --- markers) whose kind and name match.
doc() {
  awk -v kind="$1" -v name="$2" '
    /^---/ { if (d ~ ("kind: " kind "\n") && d ~ ("\n  name: " name "\n")) printf "%s", d; d = ""; next }
    { d = d $0 "\n" }
    END { if (d ~ ("kind: " kind "\n") && d ~ ("\n  name: " name "\n")) printf "%s", d }'
}

# --- disabled: no policy ---
off=$(render)
if printf '%s' "$off" | grep -q 'kind: NetworkPolicy' && [ -n "$(printf '%s' "$off" | doc NetworkPolicy lw-langwatch-nlp)" ]; then
  fail disabled "nlp NetworkPolicy rendered while disabled"
else ok disabled; fi

# --- default render equals the pre-change render (random secrets masked) ---
# The stored-objects upgrade fingerprint hashes every value, so a new key moves it.
mask() { sed -E 's/: "[A-Za-z0-9+\/=]{20,}"/: X/; s/(password|Secret|secret|key|Key): [A-Za-z0-9]{24,}/\1: X/; s/fingerprint="[0-9a-f]{64}"/fingerprint=X/'; }
old_dir=$(mktemp -d)
trap 'rm -rf "$old_dir"' EXIT
git archive HEAD . | tar -x -C "$old_dir"
cp -R charts "$old_dir/"
old_render=$(cd "$old_dir" && helm template lw . --set autogen.enabled=true 2>&1 | mask)
new_render=$(printf '%s' "$off" | mask)
[ "$old_render" = "$new_render" ] && ok default-identical || fail default-identical "default render differs from HEAD"

# --- default render: no secret wiring anywhere ---
printf '%s' "$off" | grep -q 'NLPGO_INTERNAL_SECRET' \
  && fail default-secret "default render mentions NLPGO_INTERNAL_SECRET" || ok default-secret

# --- enabled ---
on=$(render --set langwatch_nlp.networkPolicy.enabled=true --set langwatch_nlp.evaluatorRuntime.enabled=true \
  --set 'langwatch_nlp.networkPolicy.extraIngressFrom[0].namespaceSelector.matchLabels.team=evals')
np=$(printf '%s' "$on" | doc NetworkPolicy lw-langwatch-nlp)
[ -n "$np" ] && ok enabled || fail enabled "nlp NetworkPolicy missing"

printf '%s' "$np" | awk '/podSelector:/ && !seen { getline; getline; print; seen = 1 }' | grep -q 'lw-langwatch-nlp' \
  && ok target-selector || fail target-selector "spec.podSelector does not target lw-langwatch-nlp"
for pod in lw-app lw-workers; do
  printf '%s' "$np" | grep -q "app.kubernetes.io/name: $pod\$" \
    && ok "allows-$pod" || fail "allows-$pod" "ingress does not admit $pod"
done
printf '%s' "$np" | grep -q 'team: evals' && ok extra-from || fail extra-from "extraIngressFrom entry missing"
printf '%s' "$np" | grep -q 'port: 5561' && ok port || fail port "ingress port 5561 missing"
printf '%s' "$np" | grep -q -- '- Egress' && fail egress "egress must stay unrestricted" || ok egress

# --- secret: same key, same Secret on all three sides ---
secret_ref() {
  printf '%s' "$on" | doc Deployment "$1" | grep -A5 'name: NLPGO_INTERNAL_SECRET' | grep -E '^\s+(name|key):' | tr -d ' \n'
}
app=$(secret_ref lw-app); workers=$(secret_ref lw-workers); nlp=$(secret_ref lw-langwatch-nlp)
[ -n "$app" ] || fail secret "app has no NLPGO_INTERNAL_SECRET"
[ "$app" = "$workers" ] && [ "$app" = "$nlp" ] && ok secret-shared \
  || fail secret-shared "app=$app workers=$workers nlp=$nlp"
printf '%s' "$on" | doc Secret langwatch-app-secrets | grep -q 'NLPGO_INTERNAL_SECRET:' \
  && ok secret-materialised || fail secret-materialised "app Secret lacks NLPGO_INTERNAL_SECRET"

# --- existing-secret override reaches all three ---
ov=$(render --set langwatch_nlp.evaluatorRuntime.enabled=true --set langwatch_nlp.evaluatorRuntime.secrets.existingSecretName=mine --set langwatch_nlp.evaluatorRuntime.secrets.internalSecretKey=K)
[ "$(printf '%s' "$ov" | grep -c 'name: mine')" -ge 3 ] && ok override || fail override "override not on all three pods"

[ "$failures" -eq 0 ] || { echo "$failures failure(s)" >&2; exit 1; }
echo "all passed"
