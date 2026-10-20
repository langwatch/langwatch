#!/usr/bin/env bash
# Unit test for pull-request-diff-base.sh, in the lean checkout a pull request
# gate runs in: sparse, blobless, depth one, on GitHub's merge commit.
#
# Spec: specs/ci/path-filters.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../pull-request-diff-base.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $label"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

g() {
  git -c user.name=t -c user.email=t@example.com -c init.defaultBranch=main \
    -c commit.gpgsign=false "$@"
}

commit_file() {
  local repo="$1" path="$2"
  mkdir -p "$repo/$(dirname "$path")"
  echo "$path" >"$repo/$path"
  g -C "$repo" add -A
  g -C "$repo" commit -q -m "$path"
}

# @scenario "A workflow that calls dorny/paths-filter directly reads pull requests with git"
test_the_base_is_the_main_the_merge_commit_is_built_on() {
  local origin="$WORK/origin" runner="$WORK/runner" event_base merge listed
  g init -q "$origin"
  g -C "$origin" config uploadpack.allowFilter true
  g -C "$origin" config uploadpack.allowAnySHA1InWant true
  commit_file "$origin" .github/ci.yml
  event_base="$(g -C "$origin" rev-parse HEAD)"

  g -C "$origin" checkout -q -b pr
  commit_file "$origin" sdks/go/client.go

  # main moves on after the event's base commit, then GitHub's merge ref joins
  # the pull request to the newer main.
  g -C "$origin" checkout -q main
  commit_file "$origin" apps/main-only.ts
  g -C "$origin" merge -q --no-ff -m merge pr
  merge="$(g -C "$origin" rev-parse HEAD)"

  g init -q "$runner"
  g -C "$runner" remote add origin "file://$origin"
  g -C "$runner" fetch -q --no-tags --filter=blob:none --depth=1 origin "$merge"
  g -C "$runner" sparse-checkout set .github
  g -C "$runner" checkout -q --detach FETCH_HEAD

  local out base
  out="$(cd "$runner" && bash "$SCRIPT")"
  base="${out#sha=}"
  check "the base is the merge commit's first parent" \
    "sha=$(g -C "$origin" rev-parse "$merge^1")" "$out"

  # What dorny then runs: fetch the base at depth one and diff two-dot.
  g -C "$runner" fetch -q --depth=1 --no-tags origin "$base"
  listed="$(g -C "$runner" diff --no-renames --name-only "$base..HEAD")"
  check "only the pull request's own change is listed" "sdks/go/client.go" "$listed"

  g -C "$runner" fetch -q --depth=1 --no-tags origin "$event_base"
  check "the event's base commit would also list main's newer commit" \
    "apps/main-only.ts sdks/go/client.go" \
    "$(g -C "$runner" diff --no-renames --name-only "$event_base..HEAD" | tr '\n' ' ' | sed 's/ $//')"
}

test_a_commit_that_is_not_a_merge_prints_nothing() {
  local repo="$WORK/single"
  g init -q "$repo"
  commit_file "$repo" a.txt
  check "a single-parent HEAD prints no base" "" "$(cd "$repo" && bash "$SCRIPT" 2>/dev/null)"
  check "and does not fail the step" "0" "$(cd "$repo" && bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
}

test_the_base_is_the_main_the_merge_commit_is_built_on
test_a_commit_that_is_not_a_merge_prints_nothing

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
