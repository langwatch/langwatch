#!/bin/zsh
# Commits exactly the paths in a list file, through a temporary index, while
# other agents keep editing the tree. The scoped add costs seconds where a
# whole-tree add costs minutes, and nothing outside the list can be caught.
# Usage: bash dev/scripts/commit-slice.sh <listfile> "<message>"
# Build the list with `git ls-files --others --exclude-standard <dirs>` for the
# untracked side: a `git status` row for an untracked directory names the
# directory, and committing that row silently drops every file under it.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo 'usage: commit-slice.sh <listfile> <message>' >&2
  exit 2
fi

if [ -n "${GIT_INDEX_FILE:-}" ]; then
  echo 'commit-slice: refuses an inherited GIT_INDEX_FILE; use the worktree index' >&2
  exit 1
fi

check_operation() {
  local marker
  for marker in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD sequencer BISECT_START; do
    if [ -e "$(git rev-parse --git-path "$marker")" ]; then
      echo "commit-slice: active Git operation ($marker); collect through that operation without moving HEAD" >&2
      return 1
    fi
  done
  if [ -n "$(git ls-files --unmerged)" ]; then
    echo 'commit-slice: unresolved index entries; review and resolve through the active operation' >&2
    return 1
  fi
}

base=$(git rev-parse --verify HEAD)
check_operation
list=$1
msg=$2
idx=$(mktemp "${TMPDIR:-/tmp}/commit-slice-index.XXXXXX")
trap 'rm -f "$idx" "$idx.lock"' EXIT
export GIT_INDEX_FILE=$idx
git read-tree "$base"
git add --pathspec-from-file="$list"
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p "$base" -m "$msg")
unset GIT_INDEX_FILE
check_operation
git update-ref HEAD "$commit" "$base"
git reset -q --pathspec-from-file="$list"
echo "committed $(git rev-parse --short HEAD): $(git show --stat --format= HEAD | tail -1)"
