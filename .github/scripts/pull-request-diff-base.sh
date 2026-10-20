#!/usr/bin/env bash
# Prints `sha=<first parent of HEAD>`: the main a pull request's checked-out
# merge commit is built on. A workflow that calls dorny/paths-filter directly
# passes it as `base`, so the diff counts only what the pull request changes.
# dorny's default, the event's base SHA, can be older than that main, and
# diffing it against the merge commit counted main's newer commits as changed.
#
# Reads the parent from the commit object, so a depth-one checkout is enough.
# Prints nothing when HEAD is not a merge commit: dorny then falls back to the
# event's base SHA, which over-reports but never under-reports.
# Spec: specs/ci/path-filters.feature

set -euo pipefail

parents="$(git cat-file commit HEAD | sed -n 's/^parent //p')"
if [ "$(grep -c . <<<"$parents")" -ne 2 ]; then
  echo "::warning::HEAD is not a pull request merge commit; diffing from the event's base commit." >&2
  exit 0
fi
first="$(head -n 1 <<<"$parents")"
[[ "$first" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || exit 0
echo "sha=$first"
