#!/usr/bin/env bash
# Give one Lambda function image this commit's tag in ECR. Called by the
# create-manifest job of publish-docker-ecr.yml, once per Lambda repository.
#
# A Lambda function image cannot be an image index, so these tags are plain
# manifests, and `docker buildx imagetools create` (which always writes an
# index) cannot copy them. This copies a manifest under a new tag with the ECR
# API instead, keeping its media type.
#
#   publish-lambda-tag.sh <repository>
#
# Env:
#   IMAGE_TAG        the tag to publish, e.g. git-<short sha>
#   IMAGE_WAS_BUILT  "true" when build-and-push-lambda rebuilt this image this run
#                    (it pushed IMAGE_TAG itself); otherwise the `git-<sha>` image
#                    of the nearest ancestor of HEAD_COMMIT is re-tagged as
#                    IMAGE_TAG
#   HEAD_COMMIT      the commit being published (default HEAD); needs its history
#                    in the working directory's repository
#   IS_RELEASE       "true" to also write VERSION
#   VERSION          the release version tag
#   CUSTOM_TAG       "true" when IMAGE_TAG is a dispatcher's; one already in ECR
#                    fails instead of being skipped
#   EXPECTED_REVISION  the full sha of HEAD_COMMIT (default: resolved with git)
#   REGISTRY         the registry host, to read an existing tag's revision label
set -euo pipefail

image="${1:?repository name required}"
: "${IMAGE_TAG:?}"
IMAGE_WAS_BUILT="${IMAGE_WAS_BUILT:-false}"
IS_RELEASE="${IS_RELEASE:-false}"
VERSION="${VERSION:-}"
HEAD_COMMIT="${HEAD_COMMIT:-HEAD}"
EXPECTED_REVISION="${EXPECTED_REVISION:-$(git rev-parse "${HEAD_COMMIT}^{commit}")}"
export CUSTOM_TAG="${CUSTOM_TAG:-false}" EXPECTED_REVISION
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
err_file="$(mktemp)"
trap 'rm -f "${err_file}"' EXIT

is_single_manifest() {
  case "$1" in
    application/vnd.oci.image.manifest.v1+json | application/vnd.docker.distribution.manifest.v2+json) return 0 ;;
    *) return 1 ;;
  esac
}

# Succeeds when IMAGE_TAG is in ECR for this commit: it records this commit's
# revision, or it is the manifest $1 a re-tag would copy (a re-tag keeps the
# older image's label). Fails when it is not there; any other answer (a custom
# tag, another commit's image, a lookup error) stops the script.
already_published() {
  local found
  found=$(ACCEPT_DIGEST="$1" bash "${SCRIPT_DIR}/ecr-tag-published.sh" "${image}" "${IMAGE_TAG}" label) || exit 1
  [ "${found}" = "true" ]
}

digest_of() {
  aws ecr describe-images --repository-name "${image}" --image-ids imageTag="$1" \
    --query 'imageDetails[0].imageDigest' --output text
}

media_type_of() {
  aws ecr describe-images --repository-name "${image}" --image-ids imageTag="$1" \
    --query 'imageDetails[0].imageManifestMediaType' --output text
}

# Copy the manifest tagged $1 to tag $2. A re-run finds the tag already naming
# the same manifest, which ECR reports as ImageAlreadyExistsException.
put_manifest() {
  local from="$1" to="$2" manifest media_type out
  manifest=$(aws ecr batch-get-image --repository-name "${image}" \
    --image-ids imageTag="${from}" --query 'images[0].imageManifest' --output text)
  media_type=$(aws ecr batch-get-image --repository-name "${image}" \
    --image-ids imageTag="${from}" --query 'images[0].imageManifestMediaType' --output text)
  if out=$(aws ecr put-image --repository-name "${image}" --image-tag "${to}" \
      --image-manifest "${manifest}" --image-manifest-media-type "${media_type}" 2>&1); then
    return 0
  fi
  if grep -q ImageAlreadyExistsException <<<"${out}"; then
    return 0
  fi
  # The tag already names another image, and the repository's tags are immutable.
  if grep -q ImageTagAlreadyExistsException <<<"${out}"; then
    echo "::error::${image}:${to} already names another image and cannot be moved"
  fi
  echo "${out}" >&2
  return 1
}

if [ "${IMAGE_WAS_BUILT}" = "true" ]; then
  # build-and-push-lambda pushed the bare tag itself. Missing means that leg
  # failed; any other describe-images error is printed as it is.
  if ! media_type=$(media_type_of "${IMAGE_TAG}" 2>"${err_file}"); then
    if grep -q ImageNotFoundException "${err_file}"; then
      echo "::error::${image}:${IMAGE_TAG} was due to be built this run and is not in ECR; see build-and-push-lambda"
    else
      cat "${err_file}" >&2
      echo "::error::could not look up ${image}:${IMAGE_TAG} in ECR"
    fi
    exit 1
  fi
  # Checked here too, so the release tag below never copies an index.
  if ! is_single_manifest "${media_type}"; then
    echo "::error::${image}:${IMAGE_TAG} is ${media_type}, not a single manifest; see build-and-push-lambda"
    exit 1
  fi
else
  # Not rebuilt: re-tag the image built from the nearest ancestor of this
  # commit (see nearest-ancestor-tag.sh). IMAGE_TAG itself is no candidate, or
  # an existing one would always match itself below.
  candidates=$(aws ecr describe-images --repository-name "${image}" \
    --query 'imageDetails[].imageTags[]' --output text | tr '\t' '\n')
  previous=$(printf '%s\n' "${candidates}" | { grep -vxF "${IMAGE_TAG}" || true; } \
    | HEAD_COMMIT="${HEAD_COMMIT}" "${SCRIPT_DIR}/nearest-ancestor-tag.sh")
  previous_digest=""
  if [ -n "${previous}" ]; then
    previous_digest=$(digest_of "${previous}")
  fi
  if already_published "${previous_digest}"; then
    # An earlier run already published it, and the tag cannot be moved.
    echo "${image}:${IMAGE_TAG} is already in ECR for this commit; nothing to re-tag"
  elif [ -z "${previous}" ]; then
    echo "::warning::${image} has no previous git-* image from an ancestor commit to re-tag as ${IMAGE_TAG}; run this workflow via workflow_dispatch to seed it"
    exit 0
  else
    # Checked rather than assumed, so an index never reaches a function.
    media_type=$(media_type_of "${previous}")
    if ! is_single_manifest "${media_type}"; then
      echo "::error::${image}:${previous} is ${media_type}, not a single manifest; dispatch this workflow to rebuild it"
      exit 1
    fi
    echo "Re-tagging ${image} ${previous} -> ${IMAGE_TAG} (unchanged by this commit)"
    put_manifest "${previous}" "${IMAGE_TAG}"
  fi
fi

tags="${IMAGE_TAG}"
if [ "${IS_RELEASE}" = "true" ]; then
  put_manifest "${IMAGE_TAG}" "${VERSION}"
  tags="${tags}, ${VERSION}"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Published \`${image}\` to ECR with tags: ${tags}" >> "${GITHUB_STEP_SUMMARY}"
fi
echo "Published ${image} with tags: ${tags}"
