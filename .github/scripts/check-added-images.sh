#!/usr/bin/env bash
#
# Fails a PR that adds image files outside the directories where images belong.
#
# Browser-QA and PR-body screenshots are evidence for a review, not product
# source. They belong in the github.com/langwatch/pr-screenshots repo, linked by
# raw URL from the PR body. Committed here they are dead weight the moment the PR
# merges: 42 such PNGs (~5.8MB) reached main before this check existed, every one
# of them referenced by nothing.
#
# The check is a path allowlist rather than anything cleverer on purpose.
# "Is this image referenced anywhere?" sounds like the better rule but is not:
# plenty of legitimate docs images are referenced only by the docs site's own
# path conventions, so that rule flags them too.
#
# Usage: check-added-images.sh <base-ref>
#
# Spec: specs/ci/no-committed-screenshots.feature

set -euo pipefail

BASE_REF="${1:?usage: check-added-images.sh <base-ref>}"

# Where images legitimately live. Anything added outside these fails the check.
ALLOWED_PREFIXES=(
  "docs/images/"
  "docs/media/"
  "platform/app/public/"
  "assets/"
  "specs/"
  "sdks/python/examples/"
)

IMAGE_EXTENSIONS='\.(png|jpg|jpeg|gif|webp|bmp|tiff?|avif)$'

# Added files only (-A). Renaming or deleting an existing image is not this
# check's business, and neither is touching one already in an allowed home.
#
# git diff runs on its own line so a bad BASE_REF fails the script loudly under
# `set -e` — folding it into the pipe would let `|| true` (there only to absorb
# grep's exit 1 on no match) swallow the git error and silently pass the guard.
added_files=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD")
mapfile -t added_images < <(
  printf '%s\n' "${added_files}" | grep -iE "${IMAGE_EXTENSIONS}" || true
)

if [ ${#added_images[@]} -eq 0 ]; then
  echo "No images added."
  exit 0
fi

violations=()
for file in "${added_images[@]}"; do
  allowed=false
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    case "$file" in
      "$prefix"*) allowed=true; break ;;
    esac
  done
  $allowed || violations+=("$file")
done

if [ ${#violations[@]} -eq 0 ]; then
  echo "All ${#added_images[@]} added image(s) are in an allowed location."
  exit 0
fi

cat >&2 <<EOF

This PR adds ${#violations[@]} image(s) outside the directories where images belong:

EOF
printf '  %s\n' "${violations[@]}" >&2
cat >&2 <<EOF

If these are PR-body or browser-QA screenshots, they do not belong in this repo.
Push them to github.com/langwatch/pr-screenshots instead and link them from the
PR body by raw URL, pinned to a commit SHA rather than a branch name — branches
are deleted on merge, which silently 404s every image linked to one.

If this is a product or docs image, put it in one of:

EOF
printf '  %s\n' "${ALLOWED_PREFIXES[@]}" >&2
echo >&2

exit 1
