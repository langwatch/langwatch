#!/usr/bin/env bash
# Unit test for extract-failures.sh
# Asserts that the jq transform correctly extracts FAIL/AssertionError lines
# from a vitest JSON reporter fixture.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE="$SCRIPTS_DIR/__fixtures__/vitest-failures.json"
EXTRACT="$SCRIPTS_DIR/extract-failures.sh"
TMP_OUT="$(mktemp)"

PASS=0
FAIL=0

assert_exit_zero() {
  local exit_code="$1"
  if [ "$exit_code" -eq 0 ]; then
    echo "PASS: extract-failures.sh exits 0"
    PASS=$((PASS + 1))
  else
    echo "FAIL: extract-failures.sh should exit 0, got $exit_code"
    FAIL=$((FAIL + 1))
  fi
}

assert_non_empty() {
  local file="$1"
  local desc="$2"
  if [ -s "$file" ]; then
    echo "PASS: $desc is non-empty"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc is empty"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local desc="$3"
  if grep -qF "$pattern" "$file"; then
    echo "PASS: output contains '$pattern'"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — expected to find '$pattern' in:"
    cat "$file"
    FAIL=$((FAIL + 1))
  fi
}

# Run the script — disable errexit so a non-zero exit does not abort
# the test before assert_exit_zero can check it.
set +e
bash "$EXTRACT" "$FIXTURE" "$TMP_OUT"
EXIT_CODE=$?
set -e

assert_exit_zero "$EXIT_CODE"
assert_non_empty "$TMP_OUT" "test-failures.txt"
assert_contains "$TMP_OUT" "FAIL " "contains FAIL line"
assert_contains "$TMP_OUT" "traces.test.ts" "contains first failing file"
assert_contains "$TMP_OUT" "TraceDetails.test.tsx" "contains second failing file"
assert_contains "$TMP_OUT" "AssertionError:" "contains AssertionError line"
assert_contains "$TMP_OUT" "AssertionError: Error: Unable to find an element" "non-AssertionError message is prefixed with AssertionError:"

# Passing file should NOT appear
if grep -q "formatters.test.ts" "$TMP_OUT"; then
  echo "FAIL: passing file formatters.test.ts should not appear in output"
  FAIL=$((FAIL + 1))
else
  echo "PASS: passing file formatters.test.ts is absent from output"
  PASS=$((PASS + 1))
fi

rm -f "$TMP_OUT"

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

exit 0
