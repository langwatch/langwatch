#!/usr/bin/env bash
# Print the `git-<sha>` tag, read one per line from stdin, whose commit is the
# nearest ancestor of HEAD_COMMIT. Prints nothing when none is.
#
# Tags from other lines of history are skipped: re-tagging one would publish
# code HEAD_COMMIT does not contain. Push order does not decide between
# ancestors either: an older commit rebuilt later is older code, so the commit
# latest in history wins. Used by publish-docker-ecr.yml for service images and
# by publish-lambda-tag.sh for Lambda images.
#
# Env:
#   HEAD_COMMIT  the commit being published (default HEAD); its full history
#                must be in the working directory's repository

set -euo pipefail

HEAD_COMMIT="${HEAD_COMMIT:-HEAD}"

# A shallow clone would make every candidate look unrelated.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != "false" ] \
    || ! git rev-parse --verify --quiet "${HEAD_COMMIT}^{commit}" >/dev/null; then
  echo "::error::the history of ${HEAD_COMMIT} is not available; check out with full history to choose a previous image" >&2
  exit 1
fi

previous=""
previous_commit=""
while IFS= read -r tag; do
  [[ "${tag}" =~ ^git-[0-9a-f]+$ ]] || continue
  commit=$(git rev-parse --verify --quiet "${tag#git-}^{commit}" 2>/dev/null) || continue
  git merge-base --is-ancestor "${commit}" "${HEAD_COMMIT}" 2>/dev/null || continue
  # Replace the current pick only when it is itself an ancestor of this one.
  if [ -z "${previous_commit}" ] \
      || git merge-base --is-ancestor "${previous_commit}" "${commit}" 2>/dev/null; then
    previous="${tag}"
    previous_commit="${commit}"
  fi
done
printf '%s' "${previous}"
