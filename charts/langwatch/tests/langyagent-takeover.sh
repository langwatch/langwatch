#!/usr/bin/env bash
#
# Renders the standalone langyagent chart and asserts the values that let an
# install take over existing agent objects in place: selectorLabels, podLabels,
# extraEnv, extraConfig, service.annotations, progressDeadlineSeconds and an
# uncapped scratch volume. See specs/langy/langyagent-chart-takeover.feature.
#
# The selector matters most: a Deployment's spec.selector is immutable, so a
# chart that cannot render an existing Deployment's selector can only replace
# it, never adopt it.
#
# Scenario bindings use the same `@scenario` token as the bats suites,
# expressed as a hash-comment above the test function it verifies — the next
# line that is neither blank nor a comment must be that function.
#
# Usage (from charts/langwatch):
#   ./tests/langyagent-takeover.sh

# `check && pass || fail` is intended: pass only echoes and cannot fail.
# shellcheck disable=SC2015

set -euo pipefail

cd "$(dirname "$0")/../../langyagent"

failures=0
fail() {
  echo "FAIL [$1] $2"
  failures=$((failures + 1))
}
pass() { echo "ok   [$1]"; }

# Prints one kind's document from a render.
doc_of() {
  awk -v kind="$1" '
    /^---/ { if (grab) exit; next }
    $0 == "kind: " kind { grab = 1 }
    grab { print }
  '
}

# Prints the indented block under the first line matching $1, up to the next
# line at the same or a shallower indent.
block_after() {
  awk -v key="$1" '
    !found && index($0, key) { found = 1; match($0, /^ */); ind = RLENGTH; next }
    found { match($0, /^ */); if (RLENGTH <= ind && $0 !~ /^ *$/) exit; print }
  '
}

render() { helm template takeover . "$@"; }

# The tmp entry under the pod's volumes (8-space indent), not the container's
# volumeMounts entry of the same name.
scratch_volume() { awk '/^        - name: tmp$/ { grab = 1; next } grab && /^        - / { exit } grab { print }'; }

TAKEOVER=(
  --set-json 'selectorLabels={"app":"existing-agent"}'
  --set-json 'podLabels={"team":"agents","app":"other"}'
  --set-json 'extraEnv=[{"name":"EXTRA_FROM_SECRET","valueFrom":{"secretKeyRef":{"name":"agent-extra","key":"EXTRA"}}}]'
  --set-json 'extraConfig={"LOG_FORMAT":"json"}'
  --set-json 'service.annotations={"service.kubernetes.io/topology-mode":"Auto"}'
  --set progressDeadlineSeconds=1800
  --set scratchSizeLimit=
)

# @scenario "A fresh install renders the default selector"
test_default_selector() {
  local out
  out="$(render)"
  local sel
  sel="$(doc_of Deployment <<<"$out" | block_after 'matchLabels:' | head -2 | sort | tr -d ' ')"
  if [[ "$sel" == $'app.kubernetes.io/instance:takeover\napp.kubernetes.io/name:langwatch-langyagent' ]]; then
    pass "default Deployment selector"
  else
    fail "default Deployment selector" "got: $sel"
  fi
  if doc_of Service <<<"$out" | block_after 'selector:' | grep -q 'app.kubernetes.io/name: langwatch-langyagent' &&
     doc_of NetworkPolicy <<<"$out" | block_after 'podSelector:' | grep -q 'app.kubernetes.io/name: langwatch-langyagent'; then
    pass "default Service and NetworkPolicy selectors"
  else
    fail "default Service and NetworkPolicy selectors" "do not select the chart labels"
  fi
}

# @scenario "Custom selector labels reach every selector"
test_custom_selector_everywhere() {
  local out dep
  out="$(render "${TAKEOVER[@]}")"
  dep="$(doc_of Deployment <<<"$out")"
  local sel
  sel="$(block_after 'selector:' <<<"$dep" | block_after 'matchLabels:' | tr -d ' ')"
  [[ "$sel" == "app:existing-agent" ]] && pass "Deployment selector" || fail "Deployment selector" "got: $sel"
  block_after 'template:' <<<"$dep" | block_after 'labels:' | grep -q 'app: existing-agent' &&
    pass "pod template carries the selector" || fail "pod template carries the selector" "label missing"
  [[ "$(doc_of Service <<<"$out" | block_after 'selector:' | tr -d ' ')" == "app:existing-agent" ]] &&
    pass "Service selector" || fail "Service selector" "not the custom labels"
  doc_of NetworkPolicy <<<"$out" | block_after 'podSelector:' | grep -q 'app: existing-agent' &&
    pass "NetworkPolicy podSelector" || fail "NetworkPolicy podSelector" "not the custom labels"
}

# @scenario "Pod labels never displace a selector label"
test_pod_labels_keep_selector() {
  local labels
  labels="$(render "${TAKEOVER[@]}" | doc_of Deployment | block_after 'template:' | block_after 'labels:')"
  if grep -q 'app: existing-agent' <<<"$labels" && grep -q 'team: agents' <<<"$labels" && ! grep -q 'app: other' <<<"$labels"; then
    pass "selector label wins over podLabels"
  else
    fail "selector label wins over podLabels" "got: $(tr '\n' ' ' <<<"$labels")"
  fi
}

# @scenario "Extra environment entries are appended to the agent container"
test_extra_env_appended() {
  local env
  env="$(render "${TAKEOVER[@]}" | doc_of Deployment | block_after '          env:' | grep -E '^ *- name:' | sed 's/.*name: //')"
  if [[ "$(head -1 <<<"$env")" == "LANGY_INTERNAL_SECRET" && "$(tail -1 <<<"$env")" == "EXTRA_FROM_SECRET" ]]; then
    pass "extraEnv appended"
  else
    fail "extraEnv appended" "env order: $(tr '\n' ' ' <<<"$env")"
  fi
}

# @scenario "Extra config adds keys to the agent ConfigMap"
test_extra_config_added() {
  render "${TAKEOVER[@]}" | doc_of ConfigMap | grep -q '^  LOG_FORMAT: "json"$' &&
    pass "extraConfig key" || fail "extraConfig key" "LOG_FORMAT missing from the ConfigMap"
}

# @scenario "Extra config cannot replace a key the chart writes"
test_extra_config_refuses_owned_key() {
  local out
  if out="$(render --set extraConfig.ENVIRONMENT=local 2>&1)"; then
    fail "owned key refused" "render succeeded"
  elif grep -q 'extraConfig.ENVIRONMENT is set by the chart itself' <<<"$out"; then
    pass "owned key refused"
  else
    fail "owned key refused" "failed for another reason: $(tr '\n' ' ' <<<"$out" | cut -c1-200)"
  fi
}

# @scenario "Service annotations and the rollout deadline are rendered when set"
test_annotations_and_deadline() {
  local out
  out="$(render "${TAKEOVER[@]}")"
  doc_of Service <<<"$out" | grep -q 'service.kubernetes.io/topology-mode: Auto' &&
    pass "Service annotations" || fail "Service annotations" "missing"
  doc_of Deployment <<<"$out" | grep -q '^  progressDeadlineSeconds: 1800$' &&
    pass "progressDeadlineSeconds" || fail "progressDeadlineSeconds" "missing"
  render | doc_of Deployment | grep -q 'progressDeadlineSeconds' &&
    fail "no deadline by default" "rendered without being set" || pass "no deadline by default"
}

# @scenario "The scratch volume can be uncapped"
test_scratch_uncapped() {
  local tmp
  tmp="$(render "${TAKEOVER[@]}" | doc_of Deployment | scratch_volume | tr -d ' \n')"
  [[ "$tmp" == "emptyDir:{}" ]] && pass "uncapped scratch" || fail "uncapped scratch" "got: $tmp"
  render | doc_of Deployment | scratch_volume | grep -q 'sizeLimit: 1Gi' &&
    pass "default scratch cap kept" || fail "default scratch cap kept" "1Gi cap missing by default"
}

test_default_selector
test_custom_selector_everywhere
test_pod_labels_keep_selector
test_extra_env_appended
test_extra_config_added
test_extra_config_refuses_owned_key
test_annotations_and_deadline
test_scratch_uncapped

if [[ "$failures" -gt 0 ]]; then
  echo "$failures assertion(s) failed"
  exit 1
fi
echo "all langyagent takeover assertions passed"
