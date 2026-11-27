#!/usr/bin/env bash
#
# Renders the chart and asserts the outbound policy the evaluations service
# receives: BLOCK_LOCAL_HTTP_CALLS on by default, the allow-list passed when
# set, and both left to the operator when extraEnvs names them.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/langevals-egress.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

# Prints only the evaluations Deployment, so a value from another component can
# never satisfy an assertion.
render_langevals() {
  # shellcheck disable=SC2086
  helm template lw . --set autogen.enabled=true $1 | awk '
    /^# Source: langwatch\/templates\/langevals\/deployment\.yaml/ { grab=1 }
    grab && /^# Source:/ && !/langevals\/deployment\.yaml/ { grab=0 }
    grab { print }
  '
}

# value_of NAME prints the value of the first env entry NAME, or nothing.
value_of() {
  awk -v name="$2" '
    found == 1 && /value:/ { sub(/.*value: */, ""); gsub(/"/, ""); print; found = 2 }
    $0 ~ "- name: " name "$" && found == 0 { found = 1 }
  ' <<<"$1"
}

count_of() {
  grep -c -- "- name: $2\$" <<<"$1" || true
}

expect() {
  local label=$1 got=$2 want=$3
  if [ "$got" != "$want" ]; then
    echo "FAIL: $label: got '$got', want '$want'"
    failures=$((failures + 1))
  else
    echo "ok: $label"
  fi
}

# @scenario "the evaluations service refuses local addresses by default"
test_default_blocks_local_calls() {
  local block
  block=$(render_langevals "")
  expect "default BLOCK_LOCAL_HTTP_CALLS" "$(value_of "$block" BLOCK_LOCAL_HTTP_CALLS)" "true"
  expect "default has no ALLOWED_PROXY_HOSTS" "$(count_of "$block" ALLOWED_PROXY_HOSTS)" "0"
}

# @scenario "the evaluations service reaches the hosts an operator allow-lists"
test_allow_list_and_opt_out() {
  local block
  block=$(render_langevals "--set langevals.security.blockLocalHTTPCalls=false --set langevals.security.allowedProxyHosts[0]=ollama.internal --set langevals.security.allowedProxyHosts[1]=vllm.internal")
  expect "opt-out BLOCK_LOCAL_HTTP_CALLS" "$(value_of "$block" BLOCK_LOCAL_HTTP_CALLS)" "false"
  expect "ALLOWED_PROXY_HOSTS" "$(value_of "$block" ALLOWED_PROXY_HOSTS)" "ollama.internal,vllm.internal"
}

# @scenario "an operator's extraEnvs entry for the outbound policy wins"
test_extra_envs_win() {
  local block
  block=$(render_langevals "--set langevals.extraEnvs[0].name=BLOCK_LOCAL_HTTP_CALLS --set-string langevals.extraEnvs[0].value=false")
  expect "one BLOCK_LOCAL_HTTP_CALLS entry" "$(count_of "$block" BLOCK_LOCAL_HTTP_CALLS)" "1"
  expect "extraEnvs value" "$(value_of "$block" BLOCK_LOCAL_HTTP_CALLS)" "false"
}

test_default_blocks_local_calls
test_allow_list_and_opt_out
test_extra_envs_win

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi
