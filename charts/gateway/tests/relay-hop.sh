#!/usr/bin/env bash
#
# Renders the gateway chart and asserts what the pod and the cluster receive
# for the cross-pod Twilio relay hop (langwatch#8397): the pod's own
# address in GATEWAY_POD_IP, the hop container port, a NetworkPolicy that opens
# that port to the gateway's own pods and to nobody else, and no Service that
# publishes it.
#
# This executes the template pipeline rather than reading it. A grep for 5564
# passes just as happily when the port is open to the whole namespace or the
# Service routes it, and the hop port carries the relay's frames, so a rule
# that is too wide is the one defect no gateway test can see.
#
# Scenario bindings use the same `@scenario` token as shutdown-values.sh, as a
# hash-comment above the test function it verifies.
#
# Everything is held in variables: no temp files, nothing to clean up.
#
# Usage (from charts/gateway):
#   ./tests/relay-hop.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

pass() {
  echo "ok   [$1] $2"
}

# The rendered chart, or nothing at all if the render failed. Swallowing the
# failure keeps `set -e` from ending the run before the assertion that called
# it can report which case broke.
render() {
  # shellcheck disable=SC2086
  { helm template gateway . $1 --dry-run 2>/dev/null || true; }
}

# One rendered template, by its file name under templates/.
doc_of() {
  local flags="$1" file="$2"
  render "$flags" | awk -v want="# Source: langwatch-gateway/templates/$file" '
    $0 == want { grab=1; next }
    grab && /^# Source:/ { grab=0 }
    grab { print }
  '
}

# The value of one key in the rendered ConfigMap, quotes stripped.
configmap_value_of() {
  local flags="$1" key="$2"
  doc_of "$flags" "configmap.yaml" | awk -v want="$key" '
    $1 == want":" { gsub(/^"|"$/, "", $2); print $2; exit }
  '
}

# The rules of one section ("ingress" or "egress") of a NetworkPolicy read on
# stdin that list the given port, each rule printed whole with its comments
# removed. A rule starts at a four-space "- " and ends at the next one.
rules_with_port() {
  local section="$1" port="$2"
  awk -v section="$section" -v port="$port" '
    function flush() {
      if (rule ~ ("(^|\n) +port: " port "\n")) { printf "%s", rule }
      rule = ""
    }
    /^[[:space:]]*#/ { next }
    $0 ~ ("^  " section ":") { insec = 1; next }
    insec && /^  [a-zA-Z]/ { flush(); insec = 0 }
    insec && /^    - / { flush(); rule = $0 "\n"; next }
    insec && rule != "" { rule = rule $0 "\n" }
    END { flush() }
  '
}

# The two selector labels every pod of the release carries, as rendered on
# the Deployment's pod template.
pod_labels() {
  doc_of "" "deployment.yaml" | awk '
    /^      labels:/ { grab = 1; next }
    grab && /^        app\.kubernetes\.io\/(name|instance):/ { sub(/^ +/, ""); print; next }
    grab && !/^        / { grab = 0 }
  '
}

# @scenario "The pod address and the hop port reach the container"
test_the_pod_address_and_the_hop_port_reach_the_container() {
  local deployment addr override_addr override_deployment
  deployment=$(doc_of "" "deployment.yaml")
  if [ -z "$deployment" ]; then
    fail "render" "the chart did not render"
    return
  fi

  if ! grep -A4 'name: GATEWAY_POD_IP' <<<"$deployment" | grep -q 'fieldPath: status.podIP'; then
    fail "pod address" "GATEWAY_POD_IP does not come from the downward API field status.podIP"
  else
    pass "pod address" "GATEWAY_POD_IP comes from status.podIP"
  fi

  if [ -n "$(configmap_value_of "" "GATEWAY_POD_IP")" ]; then
    fail "pod address" "GATEWAY_POD_IP is also fixed in the ConfigMap, which would give every pod the same address"
  else
    pass "pod address" "GATEWAY_POD_IP is not fixed in the ConfigMap"
  fi

  if ! grep -A2 'name: relay-hop' <<<"$deployment" | grep -q 'containerPort: 5564'; then
    fail "hop port" "the container has no port named relay-hop at 5564"
  else
    pass "hop port" "the container port relay-hop is 5564"
  fi

  addr=$(configmap_value_of "" "GATEWAY_RELAY_HOP_ADDR")
  if [ "$addr" != ":5564" ]; then
    fail "hop address" "GATEWAY_RELAY_HOP_ADDR is '${addr:-<absent>}', expected :5564"
  else
    pass "hop address" "GATEWAY_RELAY_HOP_ADDR=$addr"
  fi

  override_deployment=$(doc_of "--set relayHop.port=5570" "deployment.yaml")
  override_addr=$(configmap_value_of "--set relayHop.port=5570" "GATEWAY_RELAY_HOP_ADDR")
  if ! grep -A2 'name: relay-hop' <<<"$override_deployment" | grep -q 'containerPort: 5570' || [ "$override_addr" != ":5570" ]; then
    fail "hop port override" "relayHop.port=5570 gave container port '$(grep -A2 'name: relay-hop' <<<"$override_deployment" | grep containerPort || true)' and address '${override_addr:-<absent>}'"
  else
    pass "hop port override" "relayHop.port moves the container port and the address together"
  fi
}

# @scenario "The hop port is open only to the gateway's own pods"
test_the_hop_port_is_open_only_to_the_gateways_own_pods() {
  local policy labels section rules count
  policy=$(doc_of "--set networkPolicy.enabled=true" "networkpolicy.yaml")
  labels=$(pod_labels)
  if [ -z "$policy" ] || [ -z "$labels" ]; then
    fail "render" "the network policy or the pod labels did not render"
    return
  fi

  for section in ingress egress; do
    rules=$(rules_with_port "$section" 5564 <<<"$policy")
    count=$(grep -c '^    - ' <<<"$rules" || true)
    if [ "$count" != "1" ]; then
      fail "$section rule" "expected exactly one $section rule on 5564, found $count"
      continue
    fi
    if ! grep -q 'podSelector:' <<<"$rules"; then
      fail "$section rule" "the 5564 $section rule does not select pods"
    elif grep -qE 'namespaceSelector:|ipBlock:' <<<"$rules"; then
      fail "$section rule" "the 5564 $section rule also admits a namespace or an address block"
    elif [ "$(grep -c 'port:' <<<"$rules")" != "1" ]; then
      fail "$section rule" "the 5564 $section rule opens more than the one port"
    else
      local label missing=""
      while IFS= read -r label; do
        grep -qF "$label" <<<"$rules" || missing="$missing $label"
      done <<<"$labels"
      if [ -n "$missing" ]; then
        fail "$section rule" "the 5564 $section rule does not match the gateway's own pod labels, missing:$missing"
      else
        pass "$section rule" "TCP 5564 $section only to and from pods with the gateway's labels"
      fi
    fi
  done

  # The hop port must not ride along with the customer or metrics rules.
  rules=$(rules_with_port ingress 5563 <<<"$policy")
  if grep -q 'port: 5564' <<<"$rules"; then
    fail "customer rule" "the customer ingress rule on 5563 also opens 5564"
  else
    pass "customer rule" "the customer ingress rule does not open 5564"
  fi

  if [ -n "$(doc_of "" "networkpolicy.yaml")" ]; then
    fail "policy default" "a network policy rendered with networkPolicy.enabled left at its default"
  else
    pass "policy default" "no network policy renders unless it is enabled"
  fi
}

# @scenario "The hop port is not published by a Service"
test_the_hop_port_is_not_published_by_a_service() {
  local services
  services=$(doc_of "--set service.internal.enabled=true" "service.yaml")
  if [ -z "$services" ]; then
    fail "render" "the Services did not render"
    return
  fi
  if [ "$(grep -c '^kind: Service' <<<"$services")" != "2" ]; then
    fail "services" "expected the public and the internal Service, found $(grep -c '^kind: Service' <<<"$services")"
  elif grep -qE '5564|relay-hop' <<<"$services"; then
    fail "service port" "a Service publishes the hop port: $(grep -nE '5564|relay-hop' <<<"$services" | tr '\n' ' ')"
  else
    pass "service port" "neither Service lists 5564 or relay-hop"
  fi
}

# @scenario "The relay id key reaches the container from a secret"
test_the_relay_id_key_reaches_the_container_from_a_secret() {
  local default_render keyed deployment configmap
  default_render=$(render "")
  if [ -z "$default_render" ]; then
    fail "render" "the chart did not render"
    return
  fi

  if grep -q 'LW_GATEWAY_VOICE_RELAY_ID_KEY' <<<"$default_render"; then
    fail "relay id key default" "LW_GATEWAY_VOICE_RELAY_ID_KEY renders although secrets.relayIdKey is unset"
  else
    pass "relay id key default" "nothing renders for the relay id key while secrets.relayIdKey is unset"
  fi

  keyed="--set secrets.relayIdKey=RELAY_ID_KEY --set secrets.existingSecretName=my-gateway-secrets"
  deployment=$(doc_of "$keyed" "deployment.yaml")
  configmap=$(doc_of "$keyed" "configmap.yaml")
  if ! grep -A6 'name: LW_GATEWAY_VOICE_RELAY_ID_KEY' <<<"$deployment" | grep -q 'secretKeyRef:'; then
    fail "relay id key" "LW_GATEWAY_VOICE_RELAY_ID_KEY is not a secretKeyRef when secrets.relayIdKey is set"
  elif ! grep -A6 'name: LW_GATEWAY_VOICE_RELAY_ID_KEY' <<<"$deployment" | grep -q 'name: my-gateway-secrets'; then
    fail "relay id key" "the secretKeyRef does not name secrets.existingSecretName"
  elif ! grep -A6 'name: LW_GATEWAY_VOICE_RELAY_ID_KEY' <<<"$deployment" | grep -q 'key: RELAY_ID_KEY'; then
    fail "relay id key" "the secretKeyRef does not use the key in secrets.relayIdKey"
  else
    pass "relay id key" "secrets.relayIdKey renders a secretKeyRef on the existing secret"
  fi

  if grep -q 'LW_GATEWAY_VOICE_RELAY_ID_KEY' <<<"$configmap"; then
    fail "relay id key" "the key is also in the ConfigMap, where it would be plain text"
  else
    pass "relay id key" "the key is not in the ConfigMap"
  fi
}

# @scenario "The docs say who may reach the hop port"
test_the_docs_say_who_may_reach_the_hop_port() {
  local docs="../../docs/ai-gateway/api/realtime.mdx"
  if [ ! -f "$docs" ]; then
    fail "docs" "$docs is missing"
    return
  fi

  if ! grep -q 'networkPolicy.enabled' "$docs"; then
    fail "docs network policy" "realtime.mdx does not say the hop port is limited to gateway pods only with networkPolicy.enabled=true"
  else
    pass "docs network policy" "realtime.mdx names networkPolicy.enabled"
  fi

  if ! grep -qiE 'plain (ws|websocket)|unencrypted' "$docs"; then
    fail "docs plain ws" "realtime.mdx does not say the hop is plain ws inside the pod network"
  else
    pass "docs plain ws" "realtime.mdx says the hop is not encrypted"
  fi

  if ! grep -q 'secrets.relayIdKey' "$docs"; then
    fail "docs relay id key" "realtime.mdx does not name the chart value secrets.relayIdKey"
  else
    pass "docs relay id key" "realtime.mdx names secrets.relayIdKey"
  fi
}

test_the_pod_address_and_the_hop_port_reach_the_container
test_the_hop_port_is_open_only_to_the_gateways_own_pods
test_the_hop_port_is_not_published_by_a_service
test_the_relay_id_key_reaches_the_container_from_a_secret
test_the_docs_say_who_may_reach_the_hop_port

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures assertion(s) failed"
  exit 1
fi

echo
echo "all gateway relay hop assertions passed"
