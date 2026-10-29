#!/usr/bin/env bash
# Print the `git-<sha>` tag, read one per line from stdin, of the nearest
# commit on HEAD_COMMIT's first-parent history. Prints nothing when none is.
#
# The first-parent chain is the branch's own history (on main, one commit per
# merged pull request), so the first tagged commit on it is the latest code
# HEAD_COMMIT was built on. Tags from other lines of history, including commits
# reached only through a merge's second parent, are skipped, and push order
# never decides: an older commit rebuilt later is still older code. Used by
# publish-docker-ecr.yml for service images and by tools/ecrtag (cmd/ecrtag) for
# Lambda images.
#
# Env:
#   HEAD_COMMIT  the commit being published (default HEAD); its full history
#                must be in the working directory's repository

set -euo pipefail

HEAD_COMMIT="${HEAD_COMMIT:-HEAD}"

# A shallow clone would hide the history the walk needs.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != "false" ] \
    || ! git rev-parse --verify --quiet "${HEAD_COMMIT}^{commit}" >/dev/null; then
  echo "::error::the history of ${HEAD_COMMIT} is not available; check out with full history to choose a previous image" >&2
  exit 1
fi

# "<full sha> <tag>" for every candidate that names a commit we have.
known=""
while IFS= read -r tag; do
  [[ "${tag}" =~ ^git-[0-9a-f]+$ ]] || continue
  commit=$(git rev-parse --verify --quiet "${tag#git-}^{commit}" 2>/dev/null) || continue
  known+="${commit} ${tag}"$'\n'
done
[ -n "${known}" ] || exit 0

# Walk back from HEAD_COMMIT along first parents; the first tagged commit wins.
while IFS= read -r commit; do
  tag=$(awk -v c="${commit}" '$1 == c { print $2; exit }' <<<"${known}")
  if [ -n "${tag}" ]; then
    printf '%s' "${tag}"
    exit 0
  fi
done < <(git rev-list --first-parent "${HEAD_COMMIT}")
