#!/usr/bin/env bash
# Prints `sha=<first parent of HEAD>`, the main a pull request's merge commit is
# built on, as dorny/paths-filter's `base`: the event's base SHA can be older.
# Reads the commit object, so depth one is enough. Not a merge: prints nothing,
# and dorny falls back to the event's base SHA (over-reports, never under).
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
