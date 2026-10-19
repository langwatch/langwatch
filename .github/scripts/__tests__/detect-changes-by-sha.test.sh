#!/usr/bin/env bash
# Unit test for detect-changes-by-sha.sh, the pull_request_target path.
#
# A fork-style head (reachable only through refs/pull/1/head) is fetched by SHA
# into the lean base checkout the gate runs in, and diffed. The head is never
# checked out, no file content is fetched, and every failure exits non-zero.
#
# Spec: specs/ci/path-filters.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../detect-changes-by-sha.sh"
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

g() { git -c user.name=t -c user.email=t@example.com -c init.defaultBranch=main "$@"; }

commit_file() {
  local repo="$1" file="$2"
  mkdir -p "$repo/$(dirname "$file")"
  echo "$file $RANDOM" >"$repo/$file"
  g -C "$repo" add -A
  g -C "$repo" commit -q -m "$file"
}

ORIGIN="$WORK/origin"
RUNNER="$WORK/runner"
FILTERS="relevant:
  - 'sdks/python/**'
docs:
  - 'docs/*.md'
lockfile:
  - 'uv.lock'
main-only:
  - 'main-only.txt'
untouched:
  - 'services/**'
everything:
  - '**'"

# The base repository: a pull request from a fork whose head sits six commits
# past the merge base, while main moves six commits on, then a lean checkout of
# main's tip as actions/checkout leaves it (sparse, blobless, depth one).
setup() {
  g init -q "$ORIGIN"
  g -C "$ORIGIN" config uploadpack.allowFilter true
  g -C "$ORIGIN" config uploadpack.allowReachableSHA1InWant true
  commit_file "$ORIGIN" .github/ci.yml
  commit_file "$ORIGIN" docs/old-name.md
  commit_file "$ORIGIN" uv.lock

  g -C "$ORIGIN" checkout -q -b fork
  local i
  mkdir -p "$ORIGIN/.claude"
  for i in $(seq -w 1 3050); do echo "c$i" >"$ORIGIN/.claude/c$i.md"; done
  mkdir -p "$ORIGIN/sdks/python"
  echo "s" >"$ORIGIN/sdks/python/s.py"
  g -C "$ORIGIN" mv docs/old-name.md docs/new-name.md
  g -C "$ORIGIN" add -A
  g -C "$ORIGIN" commit -q -m "fork work"
  for i in 1 2 3 4 5; do commit_file "$ORIGIN" "sdks/python/more$i.py"; done
  HEAD_SHA="$(g -C "$ORIGIN" rev-parse HEAD)"
  g -C "$ORIGIN" update-ref refs/pull/1/head "$HEAD_SHA"
  g -C "$ORIGIN" checkout -q main
  g -C "$ORIGIN" branch -q -D fork

  for i in 1 2 3 4 5; do commit_file "$ORIGIN" "main-$i.txt"; done
  commit_file "$ORIGIN" main-only.txt
  BASE_SHA="$(g -C "$ORIGIN" rev-parse HEAD)"

  g init -q "$RUNNER"
  g -C "$RUNNER" remote add origin "file://$ORIGIN"
  g -C "$RUNNER" fetch -q --no-tags --filter=blob:none --depth=1 origin "+$BASE_SHA:refs/remotes/origin/main"
  g -C "$RUNNER" sparse-checkout set .github
  g -C "$RUNNER" checkout -q --detach refs/remotes/origin/main
}

# by_sha [VAR=value ...]: runs the script in the runner, stdout only.
by_sha() {
  (cd "$RUNNER" && env GIT_NO_LAZY_FETCH=1 BASE_SHA="$BASE_SHA" HEAD_SHA="$HEAD_SHA" \
    FILTERS="$FILTERS" "$@" bash "$SCRIPT" 2>/dev/null)
}

# @scenario "A pull_request_target run diffs the head commit by SHA with git"
test_the_head_is_diffed_by_sha() {
  local out
  out="$(by_sha FETCH_DEPTHS="2 20")"
  check "a filter the head changed is true" "relevant=true" "$(grep '^relevant=' <<<"$out")"
  check "a renamed file matches under its new name" "docs=true" "$(grep '^docs=' <<<"$out")"
  check "a filter nothing changed is false" "untouched=false" "$(grep '^untouched=' <<<"$out")"
  check "a path only main changed is not the pull request's" "main-only=false" \
    "$(grep '^main-only=' <<<"$out")"
  check "a file unchanged since the merge base is false" "lockfile=false" \
    "$(grep '^lockfile=' <<<"$out")"
  check "every filter is printed once" "6" "$(grep -c '=' <<<"$out")"
  check "the checkout still sits on the base commit" "$BASE_SHA" "$(g -C "$RUNNER" rev-parse HEAD)"
  check "no path from the head is on disk" "absent" \
    "$(cd "$RUNNER" && [ -e sdks ] || [ -e .claude ] || [ -e docs ] && echo present || echo absent)"
  check "the working tree is unchanged" "" "$(g -C "$RUNNER" status --porcelain)"

  local listed
  listed="$(cd "$RUNNER" && FILTERS="$FILTERS" bash -c '
    source "$1"; PATTERNS="$(filter_patterns)"; MERGE_BASE="$(git merge-base "$2" "$3")"
    HEAD_SHA="$3"; changed_paths everything' _ "$SCRIPT" "$BASE_SHA" "$HEAD_SHA")"
  check "past 3,000 files every changed path is listed" "3058" "$(wc -l <<<"$listed" | tr -d ' ')"
}

# @scenario "A pull_request_target run that cannot diff by SHA runs everything"
test_every_failure_exits_non_zero() {
  check "no merge base within the depth cap fails" "1" \
    "$(by_sha FETCH_DEPTHS="2" >/dev/null && echo 0 || echo 1)"
  check "a head the remote does not have fails" "1" \
    "$(by_sha HEAD_SHA="$(printf 'f%.0s' $(seq 40))" >/dev/null && echo 0 || echo 1)"
  check "a head that is not a commit id fails" "1" \
    "$(by_sha HEAD_SHA='$(touch pwned)' >/dev/null && echo 0 || echo 1)"
  check "the bad head ran nothing" "absent" "$([ -e "$RUNNER/pwned" ] && echo present || echo absent)"
  check "filters that are not a mapping fail" "1" \
    "$(by_sha FILTERS="- 'a/**'" >/dev/null && echo 0 || echo 1)"
  check "a failure prints no filter" "" "$(by_sha FETCH_DEPTHS="2" || true)"
}

# @scenario "A pull_request_target filter may use neither braces nor negation"
test_picomatch_only_syntax_is_refused() {
  local filters
  for filters in "relevant: ['sdks/{go,python}/**']" "relevant: ['sdks/**', '!sdks/go/**']" \
    "relevant: [{added: 'sdks/**'}]" "relevant: ['']"; do
    check "refuses: $filters" "1" "$(by_sha FILTERS="$filters" >/dev/null && echo 0 || echo 1)"
  done
}

setup
test_the_head_is_diffed_by_sha
test_every_failure_exits_non_zero
test_picomatch_only_syntax_is_refused

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
