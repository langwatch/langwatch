#!/usr/bin/env bash
# Unit test for publish-lambda-tag.sh
#
# Runs the script against a stub `aws` that holds one ECR repository in a
# directory: one file per tag, holding "<media type> <manifest>", and a stub
# `docker` that reads an image's revision label from "labels/<tag>". The script's
# whole job is which manifest ends up under which tag, and that the tag is
# never an index, so that is what this pins. The script runs inside a scratch
# git repository whose commits the `git-<sha>` tags name:
#
#   OLD -- MID -- HEAD    the line being published
#     \
#      SIDE               another line (an older release rebuilt later)
#
# Spec: specs/ci/publish-ecr-images.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SUBJECT="$SCRIPTS_DIR/publish-lambda-tag.sh"

PLAIN="application/vnd.docker.distribution.manifest.v2+json"
INDEX="application/vnd.oci.image.index.v1+json"

PASS=0
FAIL=0
LAST_OUTPUT=""
LAST_STATUS=0

record() {
  local ok="$1" description="$2"
  if [ "$ok" = "yes" ]; then
    echo "PASS: $description"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $description"
    echo "----- output -----"
    echo "$LAST_OUTPUT"
    echo "------------------"
    FAIL=$((FAIL + 1))
  fi
}

DIRS=()
cleanup() {
  local dir
  for dir in ${DIRS+"${DIRS[@]}"}; do
    rm -rf "$dir"
  done
}
trap cleanup EXIT

REPO="$(mktemp -d)"
DIRS+=("$REPO")
commit_in_repo() {
  git -C "$REPO" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false commit -q --allow-empty -m "$1"
  git -C "$REPO" rev-parse --short HEAD
}
git -C "$REPO" init -q -b line
OLD="$(commit_in_repo old)"
git -C "$REPO" checkout -q -b side
SIDE="$(commit_in_repo side)"
git -C "$REPO" checkout -q line
MID="$(commit_in_repo mid)"
HEAD_SHA="$(commit_in_repo head)"
HEAD_FULL="$(git -C "$REPO" rev-parse HEAD)"
MID_FULL="$(git -C "$REPO" rev-parse HEAD~1)"

# A fresh stub registry. Prints its directory; tags go in "$dir/tags/<tag>",
# pushed in the order they are created (the stub lists newest first).
new_registry() {
  local dir
  dir="$(mktemp -d)"
  DIRS+=("$dir")
  mkdir -p "$dir/bin" "$dir/tags" "$dir/labels"
  cat > "$dir/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
tags="$STUB_REGISTRY/tags"
opt() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
tag_arg="$(opt --image-ids "$@")"; tag_arg="${tag_arg#imageTag=}"
query="$(opt --query "$@")"
case "$1 $2" in
  "ecr describe-images")
    if [ -z "$tag_arg" ]; then
      # Newest first, tab-separated, like --output text over imageTags[].
      ls -t "$tags" | paste -sd '\t' -
      exit 0
    fi
    # STUB_DESCRIBE_ERROR_TAG, when set, limits the error to that one tag.
    if [ -n "${STUB_DESCRIBE_ERROR:-}" ] && [ "${STUB_DESCRIBE_ERROR_TAG:-$tag_arg}" = "$tag_arg" ]; then
      echo "An error occurred ($STUB_DESCRIBE_ERROR)" >&2
      exit 254
    fi
    [ -f "$tags/$tag_arg" ] || { echo "An error occurred (ImageNotFoundException)" >&2; exit 254; }
    case "$query" in
      *imageDigest*) echo "sha256:$(cksum < "$tags/$tag_arg" | cut -d' ' -f1)" ;;
      *imageManifestMediaType*) cut -d' ' -f1 "$tags/$tag_arg" ;;
      *) echo '{"imageDetails": []}' ;;
    esac
    ;;
  "ecr batch-get-image")
    [ -f "$tags/$tag_arg" ] || { echo "An error occurred (ImageNotFoundException)" >&2; exit 254; }
    case "$query" in
      *imageManifestMediaType*) cut -d' ' -f1 "$tags/$tag_arg" ;;
      *) cut -d' ' -f2- "$tags/$tag_arg" ;;
    esac
    ;;
  "ecr put-image")
    to="$(opt --image-tag "$@")"
    manifest="$(opt --image-manifest "$@")"
    media="$(opt --image-manifest-media-type "$@")"
    echo "put-image $to" >> "$STUB_REGISTRY/calls"
    if [ -n "${STUB_PUT_ERROR:-}" ]; then
      echo "An error occurred ($STUB_PUT_ERROR)" >&2
      exit 254
    fi
    if [ -f "$tags/$to" ] && [ "$(cat "$tags/$to")" = "$media $manifest" ]; then
      echo "An error occurred (ImageAlreadyExistsException)" >&2
      exit 254
    fi
    echo "$media $manifest" > "$tags/$to"
    ;;
  *) echo "stub: unexpected aws call: $*" >&2; exit 1 ;;
esac
STUB
  cat > "$dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
[ "$1 $2 $3" = "buildx imagetools inspect" ] || { echo "stub: unexpected docker call: $*" >&2; exit 1; }
tag="${4##*:}"
if [ -f "$STUB_REGISTRY/labels/$tag" ]; then
  printf '{"rootfs":{},"config":{"Labels":{"org.opencontainers.image.revision":"%s"}}}\n' "$(cat "$STUB_REGISTRY/labels/$tag")"
else
  echo '{"rootfs":{},"config":{}}'
fi
STUB
  chmod +x "$dir/bin/aws" "$dir/bin/docker"
  echo "$dir"
}

# push <registry> <tag> <media type> <manifest>
push() {
  printf '%s %s\n' "$3" "$4" > "$1/tags/$2"
  # Distinct mtimes, so `ls -t` orders pushes.
  sleep 1
}

run_subject() {
  local registry="$1"
  shift
  LAST_STATUS=0
  LAST_OUTPUT="$(cd "$REPO" && env PATH="$registry/bin:$PATH" STUB_REGISTRY="$registry" GITHUB_STEP_SUMMARY= \
    REGISTRY=registry.invalid "$@" \
    bash "$SUBJECT" langwatch-eval-ragas 2>&1)" || LAST_STATUS=$?
}

manifest_at() {
  cut -d' ' -f2- "$1/tags/$2" 2>/dev/null || true
}

# @scenario "An image the commit did not change still gets the commit tag"
test_an_unchanged_image_gets_the_commit_tag() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$OLD" "$PLAIN" '{"older":true}'
  push "$reg" latest "$PLAIN" '{"latest":true}'
  push "$reg" "git-$MID" "$PLAIN" '{"newest":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" "git-$HEAD_SHA")" = '{"newest":true}' ]; then
    record yes "the commit tag names the newest git-* manifest, not latest"
  else
    record no "the commit tag names the newest git-* manifest, not latest"
  fi
  if [ "$(cut -d' ' -f1 "$reg/tags/git-$HEAD_SHA" 2>/dev/null)" = "$PLAIN" ]; then
    record yes "the copied tag keeps the single-manifest media type"
  else
    record no "the copied tag keeps the single-manifest media type"
  fi

  # A re-run finds the tag already there and succeeds.
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ]; then
    record yes "re-running over an existing tag succeeds"
  else
    record no "re-running over an existing tag succeeds"
  fi
}

# @scenario "An image the commit did not change is re-tagged only from an ancestor commit"
test_an_image_from_another_line_is_never_retagged() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$OLD" "$PLAIN" '{"old":true}'
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # Pushed last, from a commit the published one does not contain.
  push "$reg" "git-$SIDE" "$PLAIN" '{"side":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" "git-$HEAD_SHA")" = '{"mid":true}' ]; then
    record yes "the commit tag names the newest manifest from an ancestor, not a newer push from another line"
  else
    record no "the commit tag names the newest manifest from an ancestor, not a newer push from another line"
  fi
}

# @scenario "An image the commit did not change is re-tagged only from an ancestor commit"
test_an_older_ancestor_pushed_later_does_not_win() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # An older commit on the same line, rebuilt after MID (a release re-run).
  push "$reg" "git-$OLD" "$PLAIN" '{"old":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" "git-$HEAD_SHA")" = '{"mid":true}' ]; then
    record yes "the nearest ancestor wins over an older ancestor pushed later"
  else
    record no "the nearest ancestor wins over an older ancestor pushed later"
  fi
}

# @scenario "A re-run publishes nothing that is already there"
test_a_tag_already_in_ecr_is_left_as_it_is() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # An earlier run published this commit, from an image the re-tag would not pick.
  push "$reg" "git-$HEAD_SHA" "$PLAIN" '{"published":true}'
  echo "$HEAD_FULL" > "$reg/labels/git-$HEAD_SHA"
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" "git-$HEAD_SHA")" = '{"published":true}' ] \
      && [ ! -f "$reg/calls" ]; then
    record yes "a tag already in ECR for this commit succeeds and is not written again"
  else
    record no "a tag already in ECR for this commit succeeds and is not written again"
  fi
}

# @scenario "A commit tag already there for another commit fails the run"
test_a_tag_built_from_another_commit_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # Another commit with the same short sha published this tag.
  push "$reg" "git-$HEAD_SHA" "$PLAIN" '{"collision":true}'
  echo "$MID_FULL" > "$reg/labels/git-$HEAD_SHA"
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "for commit $MID_FULL, not $HEAD_FULL" \
      && [ ! -f "$reg/calls" ]; then
    record yes "a tag recording another commit fails, naming both commits, and writes nothing"
  else
    record no "a tag recording another commit fails, naming both commits, and writes nothing"
  fi
}

# @scenario "A commit tag already there that records no commit fails the run"
test_a_tag_with_no_revision_fails_closed() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # Published before the revision was recorded, and not the manifest a re-tag would copy.
  push "$reg" "git-$HEAD_SHA" "$PLAIN" '{"unlabelled":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "records no org.opencontainers.image.revision" \
      && [ ! -f "$reg/calls" ]; then
    record yes "a tag recording no revision fails closed and writes nothing"
  else
    record no "a tag recording no revision fails closed and writes nothing"
  fi
}

# @scenario "A dispatch with a custom tag that is already there fails the run"
test_a_custom_tag_already_there_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # Even naming exactly the manifest a re-tag would copy, and recording this commit.
  push "$reg" hotfix-1 "$PLAIN" '{"mid":true}'
  echo "$HEAD_FULL" > "$reg/labels/hotfix-1"
  run_subject "$reg" IMAGE_TAG=hotfix-1 CUSTOM_TAG=true IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "pick a new image_tag" \
      && [ ! -f "$reg/calls" ]; then
    record yes "a custom tag already in ECR fails, asks for a new tag and writes nothing"
  else
    record no "a custom tag already in ECR fails, asks for a new tag and writes nothing"
  fi
}

# @scenario "A dispatch with a custom tag that is already there fails the run"
test_a_new_custom_tag_is_written() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  run_subject "$reg" IMAGE_TAG=hotfix-2 CUSTOM_TAG=true IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" hotfix-2)" = '{"mid":true}' ]; then
    record yes "a custom tag not yet in ECR is written"
  else
    record no "a custom tag not yet in ECR is written"
  fi
}

# @scenario "A lookup that does not answer whether a tag is there fails the run"
test_a_failed_existence_check_fails_and_writes_nothing() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # Only the existence check of the commit tag errors, so a check that read the
  # error as "not there" would go on to re-tag git-$MID and write a tag.
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false \
    STUB_DESCRIBE_ERROR=AccessDeniedException STUB_DESCRIBE_ERROR_TAG="git-$HEAD_SHA"
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q AccessDeniedException \
      && [ ! -f "$reg/calls" ]; then
    record yes "a failed existence check fails, shows the registry error and writes nothing"
  else
    record no "a failed existence check fails, shows the registry error and writes nothing"
  fi
}

# @scenario "A tag that already names another image fails the run"
test_a_tag_holding_another_image_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"mid":true}'
  # The tag appears between the check and the write, holding another digest.
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false STUB_PUT_ERROR=ImageTagAlreadyExistsException
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "cannot be moved"; then
    record yes "ImageTagAlreadyExistsException fails instead of counting as published"
  else
    record no "ImageTagAlreadyExistsException fails instead of counting as published"
  fi
}

# @scenario "A Lambda image is never re-tagged from an index"
test_a_lambda_image_is_never_retagged_from_an_index() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$INDEX" '{"index":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -ne 0 ] && [ ! -f "$reg/tags/git-$HEAD_SHA" ]; then
    record yes "an index is refused and no tag is written"
  else
    record no "an index is refused and no tag is written"
  fi
}

# @scenario "A Lambda image whose build did not push its tag fails the run"
test_a_lambda_image_that_was_not_built_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"newest":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=true
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "was due to be built"; then
    record yes "a rebuilt image whose tag is missing fails, naming the image"
  else
    record no "a rebuilt image whose tag is missing fails, naming the image"
  fi
  if [ ! -f "$reg/tags/git-$HEAD_SHA" ]; then
    record yes "it does not fall back to an older image"
  else
    record no "it does not fall back to an older image"
  fi
}

# @scenario "A Lambda image is never re-tagged from an index"
test_a_rebuilt_index_is_never_given_the_release_tag() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$HEAD_SHA" "$INDEX" '{"index":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=true IS_RELEASE=true VERSION=3.9.0
  if [ "$LAST_STATUS" -ne 0 ] && [ ! -f "$reg/tags/3.9.0" ]; then
    record yes "a rebuilt tag that is an index fails and gets no version tag"
  else
    record no "a rebuilt tag that is an index fails and gets no version tag"
  fi
}

test_a_failed_lookup_of_a_rebuilt_tag_shows_the_registry_error() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$HEAD_SHA" "$PLAIN" '{"built":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=true STUB_DESCRIBE_ERROR=AccessDeniedException
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q AccessDeniedException \
      && ! printf '%s' "$LAST_OUTPUT" | grep -q "was due to be built"; then
    record yes "a failed lookup shows the registry error, not a missing build"
  else
    record no "a failed lookup shows the registry error, not a missing build"
  fi
}

# @scenario "A release also tags each Lambda image with its version"
test_a_release_also_tags_the_version() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$HEAD_SHA" "$PLAIN" '{"built":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=true IS_RELEASE=true VERSION=3.9.0
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" 3.9.0)" = '{"built":true}' ]; then
    record yes "the version tag names the commit's manifest"
  else
    record no "the version tag names the commit's manifest"
  fi
}

# @scenario "A Lambda image with no earlier image is left unpublished with a warning"
test_an_image_with_no_earlier_image_warns_and_writes_nothing() {
  local reg
  reg="$(new_registry)"
  push "$reg" latest "$PLAIN" '{"latest":true}'
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "has no previous git-\* image"; then
    record yes "an image with no git-* tag warns and succeeds"
  else
    record no "an image with no git-* tag warns and succeeds"
  fi
  if [ ! -f "$reg/tags/git-$HEAD_SHA" ] && [ ! -f "$reg/calls" ]; then
    record yes "no tag is written"
  else
    record no "no tag is written"
  fi
}

# @scenario "A tag that cannot be written fails the run"
test_a_tag_that_cannot_be_written_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" "git-$MID" "$PLAIN" '{"newest":true}'
  # The registry refuses the write with an error other than "already exists".
  run_subject "$reg" IMAGE_TAG="git-$HEAD_SHA" IMAGE_WAS_BUILT=false STUB_PUT_ERROR=AccessDeniedException
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q AccessDeniedException; then
    record yes "a refused write fails and shows the registry error"
  else
    record no "a refused write fails and shows the registry error"
  fi
  if [ ! -f "$reg/tags/git-$HEAD_SHA" ]; then
    record yes "no tag is left behind"
  else
    record no "no tag is left behind"
  fi
}

test_an_unchanged_image_gets_the_commit_tag
test_an_image_from_another_line_is_never_retagged
test_a_tag_already_in_ecr_is_left_as_it_is
test_a_failed_existence_check_fails_and_writes_nothing
test_a_tag_built_from_another_commit_fails
test_a_tag_with_no_revision_fails_closed
test_a_custom_tag_already_there_fails
test_a_new_custom_tag_is_written
test_a_tag_holding_another_image_fails
test_an_older_ancestor_pushed_later_does_not_win
test_an_image_with_no_earlier_image_warns_and_writes_nothing
test_a_tag_that_cannot_be_written_fails
test_a_lambda_image_is_never_retagged_from_an_index
test_a_lambda_image_that_was_not_built_fails
test_a_release_also_tags_the_version
test_a_rebuilt_index_is_never_given_the_release_tag
test_a_failed_lookup_of_a_rebuilt_tag_shows_the_registry_error

echo
echo "publish-lambda-tag.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
