#!/usr/bin/env bash
# Unit test for detect-changes-source.sh, plus the git path it selects.
#
# The decision table is pinned case by case. The git path is then proved in the
# same lean checkout the gate runs in (sparse, blobless, depth one), with the
# commands dorny/paths-filter runs when its token is empty: past 3,000 files,
# every path is listed and no file content is fetched.
#
# Spec: specs/ci/path-filters.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../detect-changes-source.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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

# source_for EVENT_NAME PUSH_STRATEGY CHANGED_FILES
source_for() {
  EVENT_NAME="$1" PUSH_STRATEGY="$2" CHANGED_FILES="$3" bash "$SCRIPT"
}

# @scenario "A pull request's changed paths come from git, not the files API"
test_a_pull_request_reads_git() {
  check "a small pull_request reads git" "source=git" "$(source_for pull_request force 12)"
  check "a pull_request past the API cap reads git" "source=git" \
    "$(source_for pull_request force 42596)"
  check "a pull_request with no count reads git" "source=git" "$(source_for pull_request force "")"
}

# @scenario "A pull_request_target run past the files API's cap runs everything"
test_a_large_pull_request_target_runs_everything() {
  check "3,000 files forces every filter" "source=force" \
    "$(source_for pull_request_target force 3000)"
  check "42,596 files forces every filter" "source=force" \
    "$(source_for pull_request_target force 42596)"
  check "a missing count forces every filter" "source=force" \
    "$(source_for pull_request_target force "")"
  check "a count that is not a number forces every filter" "source=force" \
    "$(source_for pull_request_target force "12; echo x")"
}

# @scenario "A pull_request_target run under the files API's cap reads the files API"
test_a_small_pull_request_target_reads_the_api() {
  check "2,999 files reads the API" "source=api" "$(source_for pull_request_target force 2999)"
  check "one file reads the API" "source=api" "$(source_for pull_request_target force 1)"
}

# @scenario "A push in diff mode is diffed with git and every other event runs everything"
test_push_and_other_events() {
  check "a diff-mode push reads git" "source=git" "$(source_for push diff "")"
  check "a force-mode push forces every filter" "source=force" "$(source_for push force "")"
  check "a push with no strategy forces every filter" "source=force" "$(source_for push "" "")"
  local event
  for event in merge_group schedule workflow_dispatch; do
    check "$event forces every filter" "source=force" "$(source_for "$event" diff "")"
  done
}

g() { git -c user.name=t -c user.email=t@example.com -c init.defaultBranch=main "$@"; }

# @scenario "Git lists every changed path in the gate's lean checkout"
test_git_lists_every_path_in_the_lean_checkout() {
  local origin="$WORK/origin" runner="$WORK/runner"
  g init -q "$origin"
  g -C "$origin" config uploadpack.allowFilter true
  g -C "$origin" config uploadpack.allowAnySHA1InWant true
  mkdir -p "$origin/.github" "$origin/docs" "$origin/apps"
  echo "on: push" > "$origin/.github/ci.yml"
  echo "old" > "$origin/docs/old-name.md"
  echo "app" > "$origin/apps/keep.ts"
  g -C "$origin" add -A
  g -C "$origin" commit -q -m base

  # The PR: 3,100 added files, the last of them sorting after the first 3,000,
  # and one rename.
  g -C "$origin" checkout -q -b pr
  local i
  for i in $(seq -w 1 1500); do
    mkdir -p "$origin/.claude/c$i" "$origin/apps/a$i"
    echo "c$i" > "$origin/.claude/c$i/f.md"
    echo "a$i" > "$origin/apps/a$i/f.ts"
  done
  mkdir -p "$origin/sdks/python"
  for i in $(seq -w 1 100); do echo "s$i" > "$origin/sdks/python/s$i.py"; done
  g -C "$origin" mv docs/old-name.md docs/new-name.md
  g -C "$origin" add -A
  g -C "$origin" commit -q -m pr

  # main moves on, then GitHub's merge ref joins the two.
  g -C "$origin" checkout -q main
  echo "main" > "$origin/main-only.txt"
  g -C "$origin" add -A
  g -C "$origin" commit -q -m "main moves"
  local base merge
  base="$(g -C "$origin" rev-parse HEAD)"
  g -C "$origin" merge -q --no-ff -m merge pr
  merge="$(g -C "$origin" rev-parse HEAD)"

  # actions/checkout with `sparse-checkout: .github`.
  g init -q "$runner"
  g -C "$runner" remote add origin "file://$origin"
  g -C "$runner" -c protocol.version=2 fetch -q --no-tags --filter=blob:none --depth=1 \
    origin "+$merge:refs/remotes/pull/1/merge"
  g -C "$runner" sparse-checkout set .github
  g -C "$runner" checkout -q --detach "refs/remotes/pull/1/merge"

  # dorny/paths-filter with an empty token: fetch the base, then diff.
  g -C "$runner" fetch -q --depth=1 --no-tags origin "$base"
  g -C "$runner" remote set-url origin "file://$WORK/unreachable"
  local listed
  listed="$(GIT_NO_LAZY_FETCH=1 g -C "$runner" diff --no-renames --name-status "$base..HEAD")"

  check "every changed path is listed" "3102" "$(printf '%s\n' "$listed" | wc -l | tr -d ' ')"
  check "a path past the first 3,000 is listed" "A	sdks/python/s100.py" \
    "$(printf '%s\n' "$listed" | grep -F sdks/python/s100.py)"
  check "the renamed file is listed under its old name" "D	docs/old-name.md" \
    "$(printf '%s\n' "$listed" | grep -F docs/old-name.md)"
  check "the renamed file is listed under its new name" "A	docs/new-name.md" \
    "$(printf '%s\n' "$listed" | grep -F docs/new-name.md)"
  check "a path only main changed is not listed" "" \
    "$(printf '%s\n' "$listed" | grep -F main-only.txt || true)"
}

test_a_pull_request_reads_git
test_a_large_pull_request_target_runs_everything
test_a_small_pull_request_target_reads_the_api
test_push_and_other_events
test_git_lists_every_path_in_the_lean_checkout

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
