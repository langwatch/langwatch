#!/usr/bin/env bash
# Unit test for ecr-tag-exists.sh, against a stub `aws` that holds one ECR
# repository in a directory: one file per tag.
#
# Spec: specs/ci/publish-ecr-images.feature

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBJECT="$(cd "$SCRIPT_DIR/.." && pwd)/ecr-tag-exists.sh"

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

REGISTRY="$(mktemp -d)"
trap 'rm -rf "$REGISTRY"' EXIT
mkdir -p "$REGISTRY/bin" "$REGISTRY/tags"
cat > "$REGISTRY/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
opt() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
[ "$1 $2" = "ecr describe-images" ] || { echo "stub: unexpected aws call: $*" >&2; exit 1; }
if [ -n "${STUB_DESCRIBE_ERROR:-}" ]; then
  echo "An error occurred ($STUB_DESCRIBE_ERROR)" >&2
  exit 254
fi
tag="$(opt --image-ids "$@")"; tag="${tag#imageTag=}"
[ -f "$STUB_REGISTRY/tags/$tag" ] || { echo "An error occurred (ImageNotFoundException)" >&2; exit 254; }
echo '{"imageDetails": []}'
STUB
chmod +x "$REGISTRY/bin/aws"
touch "$REGISTRY/tags/git-abc1234-arm64"

run_subject() {
  local stderr_file
  stderr_file="$(mktemp)"
  LAST_STATUS=0
  LAST_STDOUT="$(env PATH="$REGISTRY/bin:$PATH" STUB_REGISTRY="$REGISTRY" "$@" \
    bash "$SUBJECT" langwatch-app "$TAG" 2>"$stderr_file")" || LAST_STATUS=$?
  LAST_OUTPUT="$LAST_STDOUT"$'\n'"$(cat "$stderr_file")"
  rm -f "$stderr_file"
}

# @scenario "A re-run publishes nothing that is already there"
test_a_tag_that_is_there_is_found() {
  TAG=git-abc1234-arm64 run_subject
  if [ "$LAST_STATUS" -eq 0 ] && [ "$LAST_STDOUT" = "true" ]; then
    record yes "a tag in the repository is reported as there"
  else
    record no "a tag in the repository is reported as there"
  fi
}

# @scenario "A re-run publishes nothing that is already there"
test_a_missing_tag_is_not_found() {
  TAG=git-def5678-arm64 run_subject
  if [ "$LAST_STATUS" -eq 0 ] && [ "$LAST_STDOUT" = "false" ]; then
    record yes "a tag the repository does not hold is reported as not there"
  else
    record no "a tag the repository does not hold is reported as not there"
  fi
}

# @scenario "A lookup that does not answer whether a tag is there fails the run"
test_a_failed_lookup_fails() {
  TAG=git-abc1234-arm64 run_subject STUB_DESCRIBE_ERROR=AccessDeniedException
  if [ "$LAST_STATUS" -ne 0 ] && [ -z "$LAST_STDOUT" ] \
      && printf '%s' "$LAST_OUTPUT" | grep -q AccessDeniedException; then
    record yes "any error but ImageNotFoundException fails, answers nothing and shows the error"
  else
    record no "any error but ImageNotFoundException fails, answers nothing and shows the error"
  fi
}

test_a_tag_that_is_there_is_found
test_a_missing_tag_is_not_found
test_a_failed_lookup_fails

echo
echo "ecr-tag-exists.sh: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
