#!/usr/bin/env bash
# Decide whether a publish step may skip tag $2 of ECR repository $1, whose
# tags are immutable. Prints "false" when the tag is not there (push it) and
# "true" when it is there and holds what this run would have published (skip
# it). Fails, and so writes nothing, when the tag is there but:
#   - it is a custom tag (CUSTOM_TAG=true). A dispatcher's tag may already name
#     another commit's image, and it cannot be moved, so the dispatcher picks a
#     new one. Only the default `git-<short sha>` tag may be skipped.
#   - it records no revision. An image published before the revision was
#     recorded cannot be told apart from one built from another commit.
#   - it records a revision other than EXPECTED_REVISION. `git-<short sha>` is
#     seven characters, so two commits can share one.
# A lookup that does not answer fails as well (see ecr-tag-exists.sh).
#
#   ecr-tag-published.sh <repository> <tag> <label|annotation>
#     label       the revision is the image's org.opencontainers.image.revision
#                 label (a single manifest pushed by a build)
#     annotation  the revision is the org.opencontainers.image.revision
#                 annotation of the image index (a tag written by
#                 `docker buildx imagetools create`)
#
# Env:
#   EXPECTED_REVISION  the full sha of the commit being published
#   CUSTOM_TAG         "true" when the tag is a dispatcher's, not the default
#   REGISTRY           the registry host; needed for `label`
#   ACCEPT_DIGEST      optional. A default tag naming exactly this manifest is
#                      accepted without a revision: it is the manifest this run
#                      would have written (a re-tag copies it unchanged).
set -euo pipefail

repository="${1:?repository name required}"
tag="${2:?tag required}"
kind="${3:?label or annotation required}"
: "${EXPECTED_REVISION:?full commit sha required}"
CUSTOM_TAG="${CUSTOM_TAG:-false}"
ACCEPT_DIGEST="${ACCEPT_DIGEST:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY="org.opencontainers.image.revision"

exists=$(bash "${SCRIPT_DIR}/ecr-tag-exists.sh" "${repository}" "${tag}")
if [ "${exists}" != "true" ]; then
  echo false
  exit 0
fi

if [ "${CUSTOM_TAG}" = "true" ]; then
  echo "::error::${repository}:${tag} already exists and ECR tags cannot be moved; pick a new image_tag" >&2
  exit 1
fi

if [ -n "${ACCEPT_DIGEST}" ]; then
  digest=$(aws ecr describe-images --repository-name "${repository}" --image-ids imageTag="${tag}" \
    --query 'imageDetails[0].imageDigest' --output text)
  if [ "${digest}" = "${ACCEPT_DIGEST}" ]; then
    echo true
    exit 0
  fi
fi

case "${kind}" in
  label)
    : "${REGISTRY:?registry host required for a label}"
    # `.Image` is the image config for a single manifest, and a map of
    # platform to config for an index.
    image=$(docker buildx imagetools inspect "${REGISTRY}/${repository}:${tag}" --format '{{json .Image}}')
    revision=$(printf '%s' "${image}" \
      | jq -r --arg k "${KEY}" '(if has("rootfs") then . else first(.[]) end) | .config.Labels[$k] // empty')
    ;;
  annotation)
    manifest=$(aws ecr batch-get-image --repository-name "${repository}" --image-ids imageTag="${tag}" \
      --query 'images[0].imageManifest' --output text)
    revision=$(printf '%s' "${manifest}" | jq -r --arg k "${KEY}" '.annotations[$k] // empty')
    ;;
  *)
    echo "::error::unknown revision source ${kind}; use label or annotation" >&2
    exit 1
    ;;
esac

if [ -z "${revision}" ]; then
  echo "::error::${repository}:${tag} is already in ECR but records no ${KEY}, so this run cannot tell whether it was built from ${EXPECTED_REVISION}; it was published before the revision was recorded, and the tag cannot be moved" >&2
  exit 1
fi
if [ "${revision}" != "${EXPECTED_REVISION}" ]; then
  echo "::error::${repository}:${tag} is already in ECR for commit ${revision}, not ${EXPECTED_REVISION}; the short sha is shared, and the tag cannot be moved" >&2
  exit 1
fi
echo true
