#!/usr/bin/env bash
# Unit test for nearest-ancestor-tag.sh, on a scratch history with a merge:
#
#   BASE -- MAIN ------- MERGE -- HEAD     first-parent line
#      \                 /
#       X1 -- X2 --------                  merged branch
#
# Spec: specs/ci/publish-ecr-images.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="$SCRIPT_DIR/../nearest-ancestor-tag.sh"

PASS=0
FAIL=0
REPO="$(mktemp -d)"
trap 'rm -rf "$REPO"' EXIT

g() { git -C "$REPO" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }
commit() { g commit -q --allow-empty -m "$1"; g rev-parse --short HEAD; }

g init -q -b main
BASE="$(commit base)"
g checkout -q -b branch
X1="$(commit x1)"
X2="$(commit x2)"
g checkout -q main
MAIN="$(commit main)"
g merge -q --no-ff -m merge branch
MERGE="$(g rev-parse --short HEAD)"
HEAD_SHA="$(commit head)"

pick() { (cd "$REPO" && printf '%s\n' "$@" | HEAD_COMMIT="$HEAD_SHA" "$SUBJECT"); }

check() {
  local description="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "PASS: $description"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $description (want '$want', got '$got')"
    FAIL=$((FAIL + 1))
  fi
}

# @scenario "An image the commit did not change is re-tagged only from an ancestor commit"
test_the_nearest_first_parent_commit_wins() {
  # Newest push first, as describe-images lists them.
  check "a merged branch's commit pushed later loses to the first-parent line" \
    "git-$MAIN" "$(pick "git-$X1" "git-$MAIN" "git-$BASE")"
  check "an older first-parent commit pushed later loses to a newer one" \
    "git-$MERGE" "$(pick "git-$BASE" "git-$MERGE")"
  check "a commit only on the merged branch is never chosen" \
    "" "$(pick "git-$X2" "git-$X1")"
  check "tags that are not git-<sha> are ignored" \
    "git-$BASE" "$(pick latest "git-$BASE-arm64" "git-$BASE")"
}

test_the_nearest_first_parent_commit_wins

echo
echo "nearest-ancestor-tag.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
