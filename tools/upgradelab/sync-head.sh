#!/bin/bash
# Syncs the head checkout from this tree (tracked and untracked, never ignored files such as .env),
# installs, and writes .upgradelab-head: the commit and local changes the cells will name as head.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
head=${1:-$root/.worktrees/upgradelab-head}
cd "$root"
list=$(mktemp)
git ls-files -co --exclude-standard -z | perl -0 -ne 'print if -e substr($_, 0, -1)' > "$list" # deleted-but-tracked files would stop rsync
rsync -c -a --from0 --files-from="$list" ./ "$head/"
rm -f "$list" "$head/.env"
(cd "$head" && pnpm install --no-frozen-lockfile >/dev/null && pnpm start:prepare:files >/dev/null)
echo "$(git rev-parse --short=10 HEAD) + $(git status --porcelain | wc -l | tr -d ' ') local changes (synced $(date -u +%Y-%m-%dT%H:%MZ))" > "$head/.upgradelab-head"
cat "$head/.upgradelab-head"
