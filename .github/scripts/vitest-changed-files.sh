#!/usr/bin/env bash
# vitest-changed-files.sh <base>
# Prints the files `vitest --changed <base>` treats as changed, one per line,
# from the git root. It runs the same three git commands vitest's VitestGit
# runs (committed since the merge base, staged, untracked or modified), and
# like vitest it reads a failing command as no output: on a depth-1 CI
# checkout `git diff <base>...HEAD` fails with "no merge base" and vitest
# sees no committed changes.
#
# Empty output means vitest would select no tests. The CI test steps skip
# vitest in that case, because `vitest --changed` with an empty change set
# crashes natively on Linux (see the commit that added this script).
#
# Exits non-zero only when not inside a git repository.

set -uo pipefail

BASE="${1:?Usage: vitest-changed-files.sh <base>}"

ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1

{
  git diff --name-only "$BASE...HEAD" 2>/dev/null
  git diff --cached --name-only 2>/dev/null
  git ls-files --other --modified --exclude-standard 2>/dev/null
} | sed '/^$/d' | sort -u
exit 0
