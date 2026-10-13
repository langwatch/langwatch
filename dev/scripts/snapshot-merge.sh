#!/usr/bin/env bash
# Save tracked merge contents on a new local WIP ref without touching live state.
# This is a content checkpoint, not a portable copy of the unmerged index.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo 'usage: snapshot-merge.sh refs/heads/wip/merge-partial-<id> <message>' >&2
  exit 2
fi
if [ -n "${GIT_INDEX_FILE:-}" ]; then
  echo 'snapshot-merge: refuses an inherited GIT_INDEX_FILE' >&2
  exit 1
fi

ref=$1
case "$ref" in
  refs/heads/wip/merge-partial-?*) ;;
  *) echo 'snapshot-merge: use a new refs/heads/wip/merge-partial-<id> ref' >&2; exit 2 ;;
esac
git check-ref-format "$ref"
if git show-ref --verify --quiet "$ref"; then
  echo 'snapshot-merge: ref already exists; choose a new checkpoint name' >&2
  exit 1
fi
for marker in rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD sequencer BISECT_START; do
  if [ -e "$(git rev-parse --git-path "$marker")" ]; then
    echo "snapshot-merge: another Git operation is active ($marker)" >&2
    exit 1
  fi
done
merge_file=$(git rev-parse --git-path MERGE_HEAD)
if [ ! -s "$merge_file" ]; then
  echo 'snapshot-merge: no merge in progress' >&2
  exit 1
fi

base=$(git rev-parse --verify HEAD)
merge_heads=$(cat "$merge_file")
parents=(-p "$base")
while IFS= read -r parent; do
  parents+=(-p "$parent")
done <<< "$merge_heads"

idx=$(mktemp "${TMPDIR:-/tmp}/snapshot-merge-index.XXXXXX")
trap 'rm -f "$idx" "$idx.lock"' EXIT
cp "$(git rev-parse --git-path index)" "$idx"
GIT_INDEX_FILE="$idx" git add -u -- :/
tree=$(GIT_INDEX_FILE="$idx" git write-tree)
commit=$(git commit-tree "$tree" "${parents[@]}" -m "$2")
if [ "$(git rev-parse HEAD)" != "$base" ] || [ "$(cat "$merge_file")" != "$merge_heads" ]; then
  echo 'snapshot-merge: merge parents changed while checkpointing; no ref was created' >&2
  exit 1
fi
git update-ref "$ref" "$commit" ""
echo "snapshot $ref at $commit; HEAD and the live index were not changed"
