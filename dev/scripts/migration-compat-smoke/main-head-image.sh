#!/usr/bin/env bash
# The image of main's head (the merge commit's first parent): the published
# langwatch/langwatch:<short sha> when Docker Hub has one, else built from the
# base checkout. Hub publishes on a release or a dispatch only, so the build is
# the usual path. Usage: main-head-image.sh BASE_DIR  (prints the image reference)
set -euo pipefail

base_dir="${1:?base checkout}"
sha="$(git -C "$base_dir" rev-parse HEAD)"

for length in 7 8 9 10; do
  tag="langwatch/langwatch:${sha:0:length}"
  if docker manifest inspect "$tag" >/dev/null 2>&1 && docker pull -q "$tag" >&2; then
    echo "::notice title=migration-compat::main head ${sha} is published as ${tag}" >&2
    echo "$tag"
    exit 0
  fi
done

tag="langwatch-compat/main-head:${sha:0:12}"
echo "::notice title=migration-compat::no published image for main head ${sha}; building it from base's infra/docker/Dockerfile" >&2
DOCKER_BUILDKIT=1 docker build -q -f "${base_dir}/infra/docker/Dockerfile" -t "$tag" "$base_dir" >&2
echo "$tag"
