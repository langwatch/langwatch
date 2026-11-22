#!/usr/bin/env bash
# Unit test for vitest-changed-files.sh, against a throwaway git repository.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../vitest-changed-files.sh"
REPO="$(mktemp -d)"
trap 'rm -rf "$REPO"' EXIT

PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc"
    echo "  expected: $(printf '%q' "$expected")"
    echo "  actual:   $(printf '%q' "$actual")"
    FAIL=$((FAIL + 1))
  fi
}

g() { git -C "$REPO" -c user.name=t -c user.email=t@example.com "$@"; }

g init -q -b main
mkdir -p "$REPO/platform/app"
echo a > "$REPO/platform/app/a.ts"
g add -A
g commit -q -m base
g branch base

run() { (cd "$REPO/platform/app" && bash "$SCRIPT" "$@"); }

check "no changes since base prints nothing" "" "$(run base)"

echo b > "$REPO/CHANGELOG.md"
g add CHANGELOG.md
g commit -q -m "change outside the app"
check "a committed change is listed from the git root" "CHANGELOG.md" "$(run base)"

echo c > "$REPO/platform/app/c.ts"
check "an untracked file is listed" "$(printf 'CHANGELOG.md\nplatform/app/c.ts')" "$(run base)"

g add platform/app/c.ts
check "a staged file is listed once" "$(printf 'CHANGELOG.md\nplatform/app/c.ts')" "$(run base)"

g commit -q -m "commit the staged file"
check "a base git cannot diff against counts as no committed changes, as in vitest" "" "$(run no-such-ref)"

set +e
(cd "$(mktemp -d)" && bash "$SCRIPT" base >/dev/null 2>&1)
code=$?
set -e
if [ "$code" -ne 0 ]; then
  echo "PASS: outside a git repository exits non-zero"
  PASS=$((PASS + 1))
else
  echo "FAIL: outside a git repository should exit non-zero"
  FAIL=$((FAIL + 1))
fi

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
