#!/usr/bin/env bash
# Unit test for ecr-tag-published.sh, against a stub `aws` and `docker` that
# hold one ECR repository in a directory. "tags/<tag>" is the tag's manifest
# (its first word stands in for the digest), "labels/<tag>" the revision label
# of its image.
#
# Spec: specs/ci/publish-ecr-images.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="$(cd "$SCRIPT_DIR/.." && pwd)/ecr-tag-published.sh"

THIS=1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
OTHER=1111111bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

PASS=0
FAIL=0
LAST_OUTPUT=""
LAST_STDOUT=""
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

REGISTRY_DIR="$(mktemp -d)"
trap 'rm -rf "$REGISTRY_DIR"' EXIT
mkdir -p "$REGISTRY_DIR/bin" "$REGISTRY_DIR/tags" "$REGISTRY_DIR/labels"
cat > "$REGISTRY_DIR/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
opt() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
tag="$(opt --image-ids "$@")"; tag="${tag#imageTag=}"
query="$(opt --query "$@")"
if [ -n "${STUB_DESCRIBE_ERROR:-}" ]; then
  echo "An error occurred ($STUB_DESCRIBE_ERROR)" >&2
  exit 254
fi
[ -f "$STUB_REGISTRY/tags/$tag" ] || { echo "An error occurred (ImageNotFoundException)" >&2; exit 254; }
case "$1 $2 $query" in
  "ecr describe-images "*imageDigest*) cut -d' ' -f1 "$STUB_REGISTRY/tags/$tag" ;;
  "ecr describe-images "*) echo '{"imageDetails": []}' ;;
  "ecr batch-get-image "*imageManifest*) cut -d' ' -f2- "$STUB_REGISTRY/tags/$tag" ;;
  *) echo "stub: unexpected aws call: $*" >&2; exit 1 ;;
esac
STUB
cat > "$REGISTRY_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
[ "$1 $2 $3" = "buildx imagetools inspect" ] || { echo "stub: unexpected docker call: $*" >&2; exit 1; }
tag="${4##*:}"
labels='{}'
if [ -f "$STUB_REGISTRY/labels/$tag" ]; then
  labels="{\"Labels\":{\"org.opencontainers.image.revision\":\"$(cat "$STUB_REGISTRY/labels/$tag")\"}}"
fi
# An index answers with a map of platform to image config.
case "$tag" in
  *-index) echo "{\"linux/arm64\":{\"rootfs\":{},\"config\":$labels}}" ;;
  *) echo "{\"rootfs\":{},\"config\":$labels}" ;;
esac
STUB
chmod +x "$REGISTRY_DIR/bin/aws" "$REGISTRY_DIR/bin/docker"

# tag <name> <digest> <manifest json> [label revision]
tag() {
  printf '%s %s\n' "$2" "$3" > "$REGISTRY_DIR/tags/$1"
  if [ -n "${4:-}" ]; then echo "$4" > "$REGISTRY_DIR/labels/$1"; fi
}
tag git-1111111-arm64 sha256:built '{}' "$THIS"
tag git-1111112-arm64 sha256:other '{}' "$OTHER"
tag git-1111113-arm64 sha256:old '{}'
tag git-1111114-index sha256:idx '{}' "$THIS"
tag git-1111111 sha256:index "{\"annotations\":{\"org.opencontainers.image.revision\":\"$THIS\"}}"
tag git-1111112 sha256:index2 "{\"annotations\":{\"org.opencontainers.image.revision\":\"$OTHER\"}}"
tag git-1111113 sha256:index3 '{"manifests":[]}'
tag hotfix-1 sha256:hotfix '{}' "$THIS"

# run_subject <tag> <label|annotation> [env...]
run_subject() {
  local tag="$1" kind="$2" stderr_file
  shift 2
  stderr_file="$(mktemp)"
  LAST_STATUS=0
  LAST_STDOUT="$(env PATH="$REGISTRY_DIR/bin:$PATH" STUB_REGISTRY="$REGISTRY_DIR" REGISTRY=registry.invalid \
    EXPECTED_REVISION="$THIS" "$@" bash "$SUBJECT" langwatch-app "$tag" "$kind" 2>"$stderr_file")" || LAST_STATUS=$?
  LAST_OUTPUT="$LAST_STDOUT"$'\n'"$(cat "$stderr_file")"
  rm -f "$stderr_file"
}

# expect <answer|fail> <stderr pattern or ""> <description>
expect() {
  local want="$1" pattern="$2" description="$3" ok=no
  if [ "$want" = "fail" ]; then
    if [ "$LAST_STATUS" -ne 0 ] && [ -z "$LAST_STDOUT" ] && printf '%s' "$LAST_OUTPUT" | grep -q -- "$pattern"; then ok=yes; fi
  elif [ "$LAST_STATUS" -eq 0 ] && [ "$LAST_STDOUT" = "$want" ]; then
    ok=yes
  fi
  record "$ok" "$description"
}

# @scenario "A re-run publishes nothing that is already there"
test_a_tag_that_is_not_there_is_pushed() {
  run_subject git-2222222-arm64 label
  expect false "" "a tag not in the repository is reported as not there"
  run_subject hotfix-2 annotation CUSTOM_TAG=true
  expect false "" "a custom tag not in the repository is reported as not there"
}

# @scenario "A re-run publishes nothing that is already there"
test_a_tag_recording_this_commit_is_skipped() {
  run_subject git-1111111-arm64 label
  expect true "" "a built image labelled with this commit is skipped"
  run_subject git-1111114-index label
  expect true "" "an index whose image is labelled with this commit is skipped"
  run_subject git-1111111 annotation
  expect true "" "an index annotated with this commit is skipped"
  run_subject git-1111113-arm64 label ACCEPT_DIGEST=sha256:old
  expect true "" "a tag naming exactly the manifest a re-tag would copy is skipped without a revision"
}

# @scenario "A commit tag already there for another commit fails the run"
test_a_tag_recording_another_commit_fails() {
  run_subject git-1111112-arm64 label
  expect fail "for commit $OTHER, not $THIS" "an image labelled with another commit fails, naming both"
  run_subject git-1111112 annotation
  expect fail "for commit $OTHER, not $THIS" "an index annotated with another commit fails, naming both"
  run_subject git-1111112-arm64 label ACCEPT_DIGEST=sha256:old
  expect fail "for commit $OTHER, not $THIS" "another manifest than the one a re-tag would copy still needs its revision"
}

# @scenario "A commit tag already there that records no commit fails the run"
test_a_tag_recording_no_commit_fails_closed() {
  run_subject git-1111113-arm64 label
  expect fail "records no org.opencontainers.image.revision" "an image with no revision label fails closed"
  run_subject git-1111113 annotation
  expect fail "records no org.opencontainers.image.revision" "an index with no revision annotation fails closed"
}

# @scenario "A dispatch with a custom tag that is already there fails the run"
test_a_custom_tag_already_there_fails() {
  run_subject hotfix-1 label CUSTOM_TAG=true
  expect fail "pick a new image_tag" "a custom tag already there fails even when it records this commit"
  run_subject hotfix-1 label CUSTOM_TAG=true ACCEPT_DIGEST=sha256:hotfix
  expect fail "pick a new image_tag" "a custom tag already there fails even when it names the manifest a re-tag would copy"
}

# @scenario "A lookup that does not answer whether a tag is there fails the run"
test_a_failed_lookup_fails() {
  run_subject git-1111111-arm64 label STUB_DESCRIBE_ERROR=AccessDeniedException
  expect fail AccessDeniedException "a lookup error fails, answers nothing and shows the error"
}

test_a_tag_that_is_not_there_is_pushed
test_a_tag_recording_this_commit_is_skipped
test_a_tag_recording_another_commit_fails
test_a_tag_recording_no_commit_fails_closed
test_a_custom_tag_already_there_fails
test_a_failed_lookup_fails

echo
echo "ecr-tag-published.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
