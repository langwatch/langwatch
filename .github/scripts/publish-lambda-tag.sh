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
#                    (it pushed IMAGE_TAG itself); otherwise the newest bare
#                    `git-<sha>` image whose commit is an ancestor of HEAD_COMMIT
#                    is re-tagged as IMAGE_TAG
#   HEAD_COMMIT      the commit being published (default HEAD); needs its history
#                    in the working directory's repository
#   IS_RELEASE       "true" to also write VERSION
#   VERSION          the release version tag
set -euo pipefail

image="${1:?repository name required}"
: "${IMAGE_TAG:?}"
IMAGE_WAS_BUILT="${IMAGE_WAS_BUILT:-false}"
IS_RELEASE="${IS_RELEASE:-false}"
VERSION="${VERSION:-}"
HEAD_COMMIT="${HEAD_COMMIT:-HEAD}"

is_single_manifest() {
  case "$1" in
    application/vnd.oci.image.manifest.v1+json | application/vnd.docker.distribution.manifest.v2+json) return 0 ;;
    *) return 1 ;;
  esac
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
  echo "${out}" >&2
  return 1
}

if [ "${IMAGE_WAS_BUILT}" = "true" ]; then
  # build-and-push-lambda pushed the bare tag itself. Missing means that leg
  # failed.
  if ! aws ecr describe-images --repository-name "${image}" \
      --image-ids imageTag="${IMAGE_TAG}" >/dev/null 2>&1; then
    echo "::error::${image}:${IMAGE_TAG} was due to be built this run and is not in ECR; see build-and-push-lambda"
    exit 1
  fi
else
  # Not rebuilt: re-tag the image built from the nearest ancestor of this
  # commit. Images pushed from other lines of history are skipped: re-tagging
  # one would publish code this commit does not contain. Push time does not
  # decide between ancestors either: an older commit rebuilt later (a release
  # re-run, say) is older code, so the latest commit in history wins.
  candidates=$(aws ecr describe-images --repository-name "${image}" \
    --query 'reverse(sort_by(imageDetails, &imagePushedAt))[].imageTags[]' \
    --output text | tr '\t' '\n')
  # A shallow clone would make every candidate look unrelated.
  if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != "false" ] \
      || ! git rev-parse --verify --quiet "${HEAD_COMMIT}^{commit}" >/dev/null; then
    echo "::error::the history of ${HEAD_COMMIT} is not available; check out with full history to choose a previous ${image} image"
    exit 1
  fi
  previous=""
  previous_commit=""
  while IFS= read -r tag; do
    [[ "${tag}" =~ ^git-[0-9a-f]+$ ]] || continue
    commit=$(git rev-parse --verify --quiet "${tag#git-}^{commit}" 2>/dev/null) || continue
    git merge-base --is-ancestor "${commit}" "${HEAD_COMMIT}" 2>/dev/null || continue
    # Keep the candidate closest to HEAD: replace the current pick only when
    # it is itself an ancestor of this one.
    if [ -z "${previous_commit}" ] \
        || git merge-base --is-ancestor "${previous_commit}" "${commit}" 2>/dev/null; then
      previous="${tag}"
      previous_commit="${commit}"
    fi
  done <<<"${candidates}"
  if [ -z "${previous}" ]; then
    echo "::warning::${image} has no previous git-* image from an ancestor commit to re-tag as ${IMAGE_TAG}; run this workflow via workflow_dispatch to seed it"
    exit 0
  fi
  # Checked rather than assumed, so an index never reaches a function.
  media_type=$(media_type_of "${previous}")
  if ! is_single_manifest "${media_type}"; then
    echo "::error::${image}:${previous} is ${media_type}, not a single manifest; dispatch this workflow to rebuild it"
    exit 1
  fi
  echo "Re-tagging ${image} ${previous} -> ${IMAGE_TAG} (unchanged by this commit)"
  put_manifest "${previous}" "${IMAGE_TAG}"
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
