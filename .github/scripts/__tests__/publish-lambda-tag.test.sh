#!/usr/bin/env bash
# Unit test for publish-lambda-tag.sh
#
# Runs the script against a stub `aws` that holds one ECR repository in a
# directory: one file per tag, holding "<media type> <manifest>". The script's
# whole job is which manifest ends up under which tag, and that the tag is
# never an index, so that is what this pins.
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

# A fresh stub registry. Prints its directory; tags go in "$dir/tags/<tag>",
# pushed in the order they are created (the stub lists newest first).
new_registry() {
  local dir
  dir="$(mktemp -d)"
  DIRS+=("$dir")
  mkdir -p "$dir/bin" "$dir/tags"
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
    [ -f "$tags/$tag_arg" ] || { echo "An error occurred (ImageNotFoundException)" >&2; exit 254; }
    cut -d' ' -f1 "$tags/$tag_arg"
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
    if [ -f "$tags/$to" ] && [ "$(cat "$tags/$to")" = "$media $manifest" ]; then
      echo "An error occurred (ImageAlreadyExistsException)" >&2
      exit 254
    fi
    echo "$media $manifest" > "$tags/$to"
    ;;
  *) echo "stub: unexpected aws call: $*" >&2; exit 1 ;;
esac
STUB
  chmod +x "$dir/bin/aws"
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
  LAST_OUTPUT="$(env PATH="$registry/bin:$PATH" STUB_REGISTRY="$registry" GITHUB_STEP_SUMMARY= "$@" \
    bash "$SUBJECT" langwatch-eval-ragas 2>&1)" || LAST_STATUS=$?
}

manifest_at() {
  cut -d' ' -f2- "$1/tags/$2" 2>/dev/null || true
}

# @scenario "An image the commit did not change still gets the commit tag"
test_an_unchanged_image_gets_the_commit_tag() {
  local reg
  reg="$(new_registry)"
  push "$reg" git-aaaaaaa "$PLAIN" '{"older":true}'
  push "$reg" latest "$PLAIN" '{"latest":true}'
  push "$reg" git-bbbbbbb "$PLAIN" '{"newest":true}'
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && [ "$(manifest_at "$reg" git-ccccccc)" = '{"newest":true}' ]; then
    record yes "the commit tag names the newest git-* manifest, not latest"
  else
    record no "the commit tag names the newest git-* manifest, not latest"
  fi
  if [ "$(cut -d' ' -f1 "$reg/tags/git-ccccccc" 2>/dev/null)" = "$PLAIN" ]; then
    record yes "the copied tag keeps the single-manifest media type"
  else
    record no "the copied tag keeps the single-manifest media type"
  fi

  # A re-run finds the tag already there and succeeds.
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ]; then
    record yes "re-running over an existing tag succeeds"
  else
    record no "re-running over an existing tag succeeds"
  fi
}

# @scenario "A Lambda image is never re-tagged from an index"
test_a_lambda_image_is_never_retagged_from_an_index() {
  local reg
  reg="$(new_registry)"
  push "$reg" git-bbbbbbb "$INDEX" '{"index":true}'
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -ne 0 ] && [ ! -f "$reg/tags/git-ccccccc" ]; then
    record yes "an index is refused and no tag is written"
  else
    record no "an index is refused and no tag is written"
  fi
}

# @scenario "A Lambda image whose build did not push its tag fails the run"
test_a_lambda_image_that_was_not_built_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" git-bbbbbbb "$PLAIN" '{"newest":true}'
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=true
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "was due to be built"; then
    record yes "a rebuilt image whose tag is missing fails, naming the image"
  else
    record no "a rebuilt image whose tag is missing fails, naming the image"
  fi
  if [ ! -f "$reg/tags/git-ccccccc" ]; then
    record yes "it does not fall back to an older image"
  else
    record no "it does not fall back to an older image"
  fi
}

# @scenario "A release also tags each Lambda image with its version"
test_a_release_also_tags_the_version() {
  local reg
  reg="$(new_registry)"
  push "$reg" git-ccccccc "$PLAIN" '{"built":true}'
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=true IS_RELEASE=true VERSION=3.9.0
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
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -eq 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q "has no previous git-\* image"; then
    record yes "an image with no git-* tag warns and succeeds"
  else
    record no "an image with no git-* tag warns and succeeds"
  fi
  if [ ! -f "$reg/tags/git-ccccccc" ] && [ ! -f "$reg/calls" ]; then
    record yes "no tag is written"
  else
    record no "no tag is written"
  fi
}

# @scenario "A tag that cannot be written fails the run"
test_a_tag_that_cannot_be_written_fails() {
  local reg
  reg="$(new_registry)"
  push "$reg" git-bbbbbbb "$PLAIN" '{"newest":true}'
  # Make the registry refuse the write with an error other than "already exists".
  sed -i.bak 's|echo "put-image \$to" >> "\$STUB_REGISTRY/calls"|echo "put-image $to" >> "$STUB_REGISTRY/calls"; echo "An error occurred (AccessDeniedException)" >\&2; exit 254|' "$reg/bin/aws"
  run_subject "$reg" IMAGE_TAG=git-ccccccc IMAGE_WAS_BUILT=false
  if [ "$LAST_STATUS" -ne 0 ] && printf '%s' "$LAST_OUTPUT" | grep -q AccessDeniedException; then
    record yes "a refused write fails and shows the registry error"
  else
    record no "a refused write fails and shows the registry error"
  fi
  if [ ! -f "$reg/tags/git-ccccccc" ]; then
    record yes "no tag is left behind"
  else
    record no "no tag is left behind"
  fi
}

test_an_unchanged_image_gets_the_commit_tag
test_an_image_with_no_earlier_image_warns_and_writes_nothing
test_a_tag_that_cannot_be_written_fails
test_a_lambda_image_is_never_retagged_from_an_index
test_a_lambda_image_that_was_not_built_fails
test_a_release_also_tags_the_version

echo
echo "publish-lambda-tag.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
