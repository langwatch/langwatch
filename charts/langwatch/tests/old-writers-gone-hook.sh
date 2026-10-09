#!/usr/bin/env bash
#
# Renders the chart and asserts the opt-in post-upgrade hook that records that
# writers from before the serving roster have stopped (Round 47 E2; ADR-173,
# amendment 2026-10-08). What it may touch, and where its ServiceAccount token
# goes, are Go-template outcomes visible only in the rendered output.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/old-writers-gone-hook.sh

set -euo pipefail

cd "$(dirname "$0")/.."

readonly HOOK_TEMPLATE="langwatch/templates/app/old-writers-gone-hook.yaml"
readonly NAME="lw-old-writers-gone"
readonly BASE="--set autogen.enabled=true"
readonly ON="--set app.migrations.oldWritersGoneHook=true"

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

render() {
  local out
  # shellcheck disable=SC2086
  if ! out=$(helm template lw . $BASE $1 2>&1); then
    echo "RENDER ERROR for flags '$1':" >&2
    printf '%s\n' "$out" | head -n 20 >&2
    exit 2
  fi
  printf '%s\n' "$out"
}

hook_block() {
  render "$1" | awk -v want="$HOOK_TEMPLATE" '
    /^# Source: / { grab = ($3 == want) }
    grab { print }
  '
}

hook_doc() {
  awk -v want="$1" '
    /^# Source: / {
      if (kind == want) { printf "%s", buf }
      buf = ""; kind = ""; next
    }
    /^kind: / { kind = $2 }
    { buf = buf $0 "\n" }
    END { if (kind == want) printf "%s", buf }
  '
}

expect_contains() {
  local label="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*) return 0 ;;
  esac
  fail "$label" "expected to find: ${needle}"
  return 1
}

expect_absent() {
  local label="$1" haystack="$2" needle="$3"
  case "$haystack" in
    *"$needle"*)
      fail "$label" "must not contain: ${needle}"
      return 1
      ;;
  esac
  return 0
}

test_default_renders_no_hook() {
  local block
  block=$(hook_block "")
  if [ -n "$block" ]; then
    fail "default" "the hook rendered with the knob off"
    return
  fi
  echo "ok   [default] no ${NAME} rendered"
}

test_hook_documents_are_post_upgrade_only() {
  local block doc kind
  block=$(hook_block "$ON")
  for kind in ServiceAccount Role RoleBinding Job; do
    doc=$(printf '%s\n' "$block" | hook_doc "$kind")
    if [ -z "$doc" ]; then
      fail "$kind" "no ${kind} rendered with the knob on"
      continue
    fi
    if ! printf '%s\n' "$doc" | grep -Eq 'helm.sh/hook: post-upgrade$'; then
      fail "$kind" "its hook is not exactly post-upgrade"
      continue
    fi
    echo "ok   [$kind] post-upgrade only"
  done
}

test_role_is_scoped() {
  local role
  role=$(hook_block "$ON" | hook_doc Role)
  expect_contains "role" "$role" "verbs: [\"get\"]" || return
  expect_contains "role" "$role" "- \"lw-app\"" || return
  expect_contains "role" "$role" "- \"lw-workers\"" || return
  expect_absent "role" "$role" "list" || return
  expect_absent "role" "$role" "secrets" || return
  echo "ok   [role] get on the two Deployments only"
}


test_token_reaches_the_wait_only() {
  local job assert_block
  job=$(hook_block "$ON" | hook_doc Job)
  expect_contains "token" "$job" "automountServiceAccountToken: false" || return
  expect_contains "token" "$job" "name: kube-api-access" || return
  assert_block=$(printf '%s\n' "$job" | awk '/- name: assert/ { grab = 1 } grab { print }')
  expect_absent "token" "$assert_block" "kube-api-access" || return
  echo "ok   [token] kube-api-access is mounted in wait-for-rollout only"
}

test_assert_container_runs_the_command() {
  local job
  job=$(hook_block "$ON" | hook_doc Job)
  expect_contains "assert" "$job" "pnpm -s task upgrade old-writers-gone" || return
  echo "ok   [assert] the assert container runs the old-writers-gone command"
}

test_default_renders_no_hook
test_hook_documents_are_post_upgrade_only
test_role_is_scoped
test_token_reaches_the_wait_only
test_assert_container_runs_the_command

# shellcheck disable=SC2086
helm lint . $BASE $ON >/dev/null || fail "lint" "helm lint failed with the knob on"

if [ "$failures" -gt 0 ]; then
  echo "$failures assertion(s) failed"
  exit 1
fi

echo "all old-writers-gone-hook assertions passed"
