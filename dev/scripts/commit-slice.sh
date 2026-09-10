#!/bin/zsh
# Commits exactly the paths in a list file, through a temporary index, while
# other agents keep editing the tree. The scoped add costs seconds where a
# whole-tree add costs minutes, and nothing outside the list can be caught.
# Usage: bash dev/scripts/commit-slice.sh <listfile> "<message>"
# Build the list with `git ls-files --others --exclude-standard <dirs>` for the
# untracked side: a `git status` row for an untracked directory names the
# directory, and committing that row silently drops every file under it.
set -e
list=$1
msg=$2
idx=$(mktemp "${TMPDIR:-/tmp}/commit-slice-index.XXXXXX")
export GIT_INDEX_FILE=$idx
git read-tree HEAD
git add --pathspec-from-file="$list"
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p HEAD -m "$msg")
unset GIT_INDEX_FILE
git update-ref HEAD "$commit"
git reset -q --pathspec-from-file="$list"
rm -f "$idx"
echo "committed $(git rev-parse --short HEAD): $(git show --stat --format= HEAD | tail -1)"
