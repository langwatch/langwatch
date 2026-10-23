#!/usr/bin/env bash
# Checks every Lambda Dockerfile's runtime stage (the last FROM) for an explicit
# WORKDIR outside /home. Lambda runs a container image as its own
# least-privileged user, never the image's USER. The distroless nonroot bases
# set WORKDIR /home/nonroot, mode 0700 for uid 65532, which that user cannot
# enter, so every start fails with Runtime.InvalidEntrypoint before the runtime
# runs anything. A build cannot catch it: the image is valid everywhere but on
# Lambda.
#
# Spec: specs/ci/publish-ecr-images.feature
# @scenario "A Lambda image starts in a directory Lambda's own user can enter"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../../infra/docker" && pwd)"

PASS=0
FAIL=0

# The last WORKDIR after the last FROM, or nothing.
runtime_workdir() {
  awk 'toupper($1) == "FROM" { workdir = "" } toupper($1) == "WORKDIR" { workdir = $2 } END { print workdir }' "$1"
}

check() {
  local dockerfile="$1"
  local name workdir
  name="$(basename "$dockerfile")"
  workdir="$(runtime_workdir "$dockerfile")"
  case "$workdir" in
    "" )
      echo "FAIL: $name: the runtime stage sets no WORKDIR, so it inherits the base's"
      FAIL=$((FAIL + 1)) ;;
    /home | /home/* )
      echo "FAIL: $name: the runtime stage starts in $workdir, which Lambda's user cannot enter"
      FAIL=$((FAIL + 1)) ;;
    * )
      echo "PASS: $name starts in $workdir"
      PASS=$((PASS + 1)) ;;
  esac
}

found=0
for dockerfile in "$DOCKER_DIR"/Dockerfile.*.lambda; do
  [ -e "$dockerfile" ] || continue
  found=1
  check "$dockerfile"
done
if [ "$found" -eq 0 ]; then
  echo "FAIL: no Lambda Dockerfiles found under $DOCKER_DIR"
  FAIL=$((FAIL + 1))
fi

echo
echo "lambda-dockerfiles: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
