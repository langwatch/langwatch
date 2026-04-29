#!/usr/bin/env bash
# Template-level regression tests for ClickHouse password secret (#3440).
#
# Verifies that the url-secret.yaml template handles install/upgrade
# correctly and never generates random passwords on upgrade without
# explicit password.
#
# Requirements: helm (no cluster needed)
set -euo pipefail

CHART_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE="test"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
pass()  { echo -e "${GREEN}[PASS]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }
sep()   { echo -e "\n${CYAN}────────────────────────────────────────────────${NC}"; }

tmpl() {
  helm template "$RELEASE" "$CHART_DIR" \
    --set autogen.enabled=true \
    --show-only templates/clickhouse/url-secret.yaml \
    "$@" 2>&1
}

PASSED=0
FAILED=0

assert_renders() {
  local label="$1"; shift
  local out
  if out=$(tmpl "$@"); then
    if echo "$out" | grep -q 'kind: Secret'; then
      pass "$label"
      PASSED=$((PASSED + 1))
    else
      fail "$label: rendered but no Secret found"
    fi
  else
    echo "$out"
    fail "$label: template failed to render"
  fi
}

assert_fails_with() {
  local label="$1" expected_msg="$2"; shift 2
  local out
  if out=$(tmpl "$@" 2>&1); then
    fail "$label: expected template to fail but it succeeded"
  else
    if echo "$out" | grep -qF "$expected_msg"; then
      pass "$label"
      PASSED=$((PASSED + 1))
    else
      echo "$out"
      fail "$label: template failed but with unexpected error (expected: $expected_msg)"
    fi
  fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$label"
    PASSED=$((PASSED + 1))
  else
    fail "$label: expected to find '$needle'"
  fi
}

assert_password_stable() {
  local label="$1"; shift
  local pw1 pw2
  pw1=$(tmpl "$@" | grep '^\s*password:' | head -1 | sed 's/.*password: *//' | tr -d '"')
  pw2=$(tmpl "$@" | grep '^\s*password:' | head -1 | sed 's/.*password: *//' | tr -d '"')
  if [[ "$pw1" == "$pw2" ]]; then
    pass "$label"
    PASSED=$((PASSED + 1))
  else
    fail "$label: password not stable across renders ('$pw1' vs '$pw2')"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
sep; info "Suite: ClickHouse url-secret.yaml template tests (#3440)"

# 1. Fresh install without explicit password — generates random password
sep; info "Test: fresh install generates password"
assert_renders "install renders Secret"

# 2. Fresh install with explicit password — uses it
sep; info "Test: fresh install with explicit password"
OUT=$(tmpl --set clickhouse.auth.password=MyExplicitPass)
assert_contains "install uses explicit password" "$OUT" "MyExplicitPass"

# 3. Upgrade without explicit password — fails with helpful error
sep; info "Test: upgrade without password fails"
assert_fails_with \
  "upgrade without password fails" \
  "clickhouse.auth.password is required on upgrade" \
  --is-upgrade

# 4. Upgrade with explicit password — succeeds
sep; info "Test: upgrade with explicit password"
OUT=$(tmpl --is-upgrade --set clickhouse.auth.password=UpgradePass)
assert_contains "upgrade uses explicit password" "$OUT" "UpgradePass"

# 5. Explicit password is stable across renders (no random regeneration)
sep; info "Test: explicit password stable across renders"
assert_password_stable "password stable" --set clickhouse.auth.password=StablePass

# 6. URL contains the password
sep; info "Test: URL embeds password"
OUT=$(tmpl --set clickhouse.auth.password=UrlTestPass)
assert_contains "URL contains password" "$OUT" "UrlTestPass"
assert_contains "URL targets clickhouse service" "$OUT" "test-clickhouse:8123/langwatch"

sep
echo -e "\n${GREEN}All $PASSED tests passed.${NC}"
