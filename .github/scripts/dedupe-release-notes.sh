#!/usr/bin/env bash
#
# Deduplicates the release-note entries on every open release branch.
#
# Runs in release-please-sdks.yml AFTER the release-please action. Squash merges
# with COMMIT_MESSAGES parse one commit as two entries when the commit body
# opens with its own conventional-commit line (#7206), and Release Please
# rewrites each release branch from git history on every run, so the duplicates
# would come back with any one-time fix. This pass removes them after every
# regeneration instead: what a release PR merges is what this leaves behind.
#
# Environment:
#   GITHUB_TOKEN     credentials for ls-remote/fetch/push and for asking
#                    GitHub which pull request a duplicated sha merged, so the
#                    entry naming the merged pull request is the one kept.
#
# Usage: dedupe-release-notes.sh

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
cd "$repo_root"

branches="$(git ls-remote --heads origin 'release-please--branches--*' | awk '{print $2}' | sed 's|refs/heads/||')"

if [ -z "$branches" ]; then
  echo "no release branches to deduplicate"
  exit 0
fi

git config user.name "langwatch-ci"
git config user.email "ci@langwatch.langwatch.ai"

worktree_root="$(mktemp -d)"
trap 'git worktree list --porcelain | sed -n "s/^worktree //p" | grep "^$worktree_root" | xargs -r git worktree remove --force; rm -rf "$worktree_root"' EXIT

while IFS= read -r branch; do
  [ -n "$branch" ] || continue
  echo "checking $branch"
  git fetch --force --depth=1 origin "$branch"

  worktree="$worktree_root/${branch//\//-}"
  git worktree add --detach "$worktree" FETCH_HEAD

  # Every package the manifest releases carries a changelog at its root; only
  # the ones present on this branch can hold entries.
  paths=()
  while IFS= read -r package_path; do
    changelog="$package_path/CHANGELOG.md"
    if [ -f "$worktree/$changelog" ]; then
      paths+=("$changelog")
    fi
  done < <(jq -r '.packages | keys[]' "$worktree/.github/release-please-config.json")

  if [ "${#paths[@]}" -eq 0 ]; then
    echo "  no changelogs on $branch"
    continue
  fi

  (cd "$worktree" && node --experimental-strip-types \
    "$script_dir/dedupe-release-notes.ts" "${paths[@]}")

  if git -C "$worktree" diff --quiet; then
    echo "  clean"
    continue
  fi

  git -C "$worktree" add -u
  git -C "$worktree" commit -m "chore: keep one release-note entry per commit"
  git -C "$worktree" push origin "HEAD:refs/heads/$branch"
  echo "  pushed deduplicated entries"
done <<< "$branches"
