#!/usr/bin/env bash
# What a merge session needs to know before it resolves anything, read from the
# index rather than remembered. A long merge outlives the session that started
# it, so every number here is recomputed on demand.
#
#   (no arguments)   fast. Is a merge in progress, how much is left, and the
#                    two classes git will not show you as conflicts.
#   --full           adds the per-area breakdown. A few seconds.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

if [ ! -f .git/MERGE_HEAD ]; then
  printf 'no merge in progress.\n'
  exit 0
fi

THEIRS=$(cat .git/MERGE_HEAD)
OURS=$(git rev-parse HEAD)
BASE=$(git merge-base "$OURS" "$THEIRS")

printf 'merge in progress\n'
printf '  ours   %s  %s\n' "${OURS:0:9}" "$(git rev-parse --abbrev-ref HEAD)"
printf '  theirs %s\n' "${THEIRS:0:9}"
printf '  base   %s\n' "${BASE:0:9}"

unmerged=$(git diff --name-only --diff-filter=U | wc -l | tr -d ' ')
markers=$(git grep -l '^<<<<<<< ' -- . 2>/dev/null | wc -l | tr -d ' ')
printf '\nunmerged %s   files with markers %s\n' "$unmerged" "$markers"

printf '\nby class\n'
git status --porcelain \
  | grep -E '^(DD|AU|UD|UA|DU|AA|UU) ' \
  | cut -c1-2 | sort | uniq -c | sort -rn \
  | awk '{printf "  %-4s %s\n", $2, $1}'

# The two classes git reports as resolved, and the reason a merge that looks
# finished can still have reverted work. Neither carries a conflict marker.
printf '\nsilent classes (no marker, no conflict - review these by hand)\n'

# A tree our branch deleted in full, that they added new files into: git sees
# base-absent + ours-absent + theirs-present and stages a clean add.
resurrect=0
for dir in $(git status --porcelain | awk '/^A  /{print $2}' | awk -F/ 'NF>1{print $1"/"$2}' | sort -u); do
  ours_n=$(git ls-tree -r --name-only "$OURS" -- "$dir" | wc -l | tr -d ' ')
  base_n=$(git ls-tree -r --name-only "$BASE" -- "$dir" | wc -l | tr -d ' ')
  if [ "$ours_n" -eq 0 ] && [ "$base_n" -gt 0 ]; then
    n=$(git status --porcelain -- "$dir" | grep -c '^A  ' || true)
    printf '  RESURRECTED  %-28s %s staged adds into a tree this branch deleted (%s files in base)\n' "$dir" "$n" "$base_n"
    resurrect=$((resurrect + n))
  fi
done
[ "$resurrect" -eq 0 ] && printf '  RESURRECTED  none\n'

# Ported-away files they kept changing: ours deleted, theirs modified. Git
# flags these, but "keep the delete" silently drops whatever they changed.
du=$(git status --porcelain | grep -c '^DU ' || true)
printf '  PORT-OR-DROP %s deleted-by-us / modified-by-them - each one is a change of theirs that lands nowhere unless ported\n' "$du"

# Files carrying the old tree's import specifiers. A directory-rename port
# lands the content at the right path with the wrong imports, and nothing
# else counts them.
stale=$(git grep -l -E 'from "(~|@ee)/' -- . 2>/dev/null | wc -l | tr -d ' ')
printf '  STALE-IMPORT  %s files still importing the old tree (~/ or @ee/) - content ported, imports not\n' "$stale"

# A file that still holds markers but is no longer unmerged has been staged as
# resolved while unresolved - `git add` on a directory does this, and it also
# destroys the stages the resolution method needs. Nothing else reports it.
staged_unresolved=0
for f in $(git grep -l '^<<<<<<< ' -- . 2>/dev/null); do
  if git rev-parse ":0:$f" >/dev/null 2>&1; then
    staged_unresolved=$((staged_unresolved + 1))
    printf '  STAGED-UNRESOLVED  %s\n' "$f"
  fi
done
if [ "$staged_unresolved" -gt 0 ]; then
  printf '  ^^ %s file(s) carry markers but are staged as resolved. Their :1:/:2:/:3: stages\n' "$staged_unresolved"
  printf '     are gone; rebuild them from HEAD / MERGE_HEAD / merge-base before resolving.\n'
fi

[ "${1:-}" = "--full" ] || exit 0

printf '\nmarkers by area\n'
git grep -l '^<<<<<<< ' -- . 2>/dev/null \
  | awk -F/ '{print $1"/"$2}' | sort | uniq -c | sort -rn \
  | awk '{printf "  %-34s %s\n", $2, $1}'

printf '\nunmerged by area\n'
git diff --name-only --diff-filter=U \
  | awk -F/ '{print $1"/"$2}' | sort | uniq -c | sort -rn | head -20 \
  | awk '{printf "  %-34s %s\n", $2, $1}'
