#!/usr/bin/env bash
# Prints `<filter>=true|false` for every filter in FILTERS on a
# pull_request_target run. BASE_SHA and HEAD_SHA are fetched as objects into
# the base checkout and diffed by SHA; nothing from the head is checked out or
# run. Any failure exits non-zero, and the action then forces every filter.
# Spec: specs/ci/path-filters.feature ("The gate never under-reports").

set -euo pipefail

# Depths tried in turn until the merge base resolves; past the last, give up.
FETCH_DEPTHS="${FETCH_DEPTHS:-50 500 5000}"

die() {
  echo "detect-changes: $*" >&2
  exit 1
}

# mikefarah yq on the runners, kislyuk yq on some laptops: both emit JSON here.
filters_as_json() {
  if yq --version 2>&1 | grep -q mikefarah; then yq -o=json '.'; else yq '.'; fi
}

# The filter names, one per line, in declaration order.
filter_keys() {
  printf '%s\n' "$FILTERS" | filters_as_json | jq -r '
    if type == "object" then keys_unsorted[] else error("filters is not a mapping") end
    | if test("^[A-Za-z0-9_-]+$") then . else error("filter name \(.) is not a plain word") end'
}

# One `<filter>\t<pattern>` line per pattern. Braces and `!` negation mean
# something to dorny's picomatch and nothing to a git pathspec, so they are
# refused, as is a change-type rule (`added: ...`): dorny alone reads those.
filter_patterns() {
  printf '%s\n' "$FILTERS" | filters_as_json | jq -r '
    to_entries[] | .key as $key
    | (.value | if type == "array" then flatten[] else . end)
    | if type != "string" or . == "" then error("filter \($key) has a rule that is not a path pattern")
      elif test("[{}]") then error("filter \($key) uses braces, which git cannot match: \(.)")
      elif startswith("!") then error("filter \($key) uses negation, which git cannot match: \(.)")
      elif test("[[:cntrl:]]") then error("filter \($key) has a control character in a pattern")
      else "\($key)\t\(.)" end'
}

# Git pathspecs, one per line, selecting what one picomatch pattern selects.
# Git lets a wildcard-free pathspec match everything beneath it as a directory,
# so bracketing the last character makes it match the one path only. Picomatch
# lets `dir/**` match `dir` itself, so that path gets a pathspec of its own.
pathspecs_for() {
  local pattern
  for pattern in "$1" "${1%/\*\*}"; do
    if [[ "$pattern" != *[*?[]* && "${pattern: -1}" =~ [A-Za-z0-9._-] ]]; then
      pattern="${pattern%?}[${pattern: -1}]"
    fi
    printf ':(glob)%s\n' "$pattern"
    [[ "$1" == */\*\* ]] || break
  done
}

# Fetches both commits as objects, deepening until they share a merge base.
merge_base() {
  local depth
  for depth in $FETCH_DEPTHS; do
    git fetch --quiet --no-tags --no-recurse-submodules --filter=blob:none \
      --depth="$depth" origin "$BASE_SHA" "$HEAD_SHA" >&2 ||
      die "could not fetch $BASE_SHA and $HEAD_SHA at depth $depth"
    if git merge-base "$BASE_SHA" "$HEAD_SHA" 2>/dev/null; then return 0; fi
  done
  die "no merge base within the last $depth commits of either side"
}

# The changed paths one filter matches, diffing MERGE_BASE against HEAD_SHA.
changed_paths() {
  local key="$1" name pattern spec pathspecs=()
  while IFS=$'\t' read -r name pattern; do
    if [ "$name" = "$key" ]; then
      while IFS= read -r spec; do pathspecs+=("$spec"); done < <(pathspecs_for "$pattern")
    fi
  done <<<"$PATTERNS"
  [ "${#pathspecs[@]}" -gt 0 ] || return 0
  git diff --no-renames --no-ext-diff --no-textconv --name-only \
    "$MERGE_BASE" "$HEAD_SHA" -- "${pathspecs[@]}"
}

main() {
  [[ "${BASE_SHA:-}" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || die "BASE_SHA is not a commit id"
  [[ "${HEAD_SHA:-}" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || die "HEAD_SHA is not a commit id"
  unset GIT_LITERAL_PATHSPECS GIT_GLOB_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_ICASE_PATHSPECS

  local keys key paths result=""
  keys="$(filter_keys)"
  PATTERNS="$(filter_patterns)"
  MERGE_BASE="$(merge_base)"
  for key in $keys; do
    paths="$(changed_paths "$key")"
    echo "detect-changes: $key matches $(printf '%s' "$paths" | grep -c '' || true) changed paths" >&2
    result+="$key=$([ -n "$paths" ] && echo true || echo false)"$'\n'
  done
  printf '%s' "$result"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main
fi
