#!/usr/bin/env bash
# Sign a single already-pushed multi-arch image with keyless cosign, generate a
# per-platform CycloneDX SBOM, and attach it as a cosign attestation. Operates on
# images that are already in the registry by digest; it does not build anything.
#
# Shared by:
#   - .github/workflows/publish-docker-app.yml  (signs each image right after a release build)
#   - .github/workflows/sign-release-images.yml (backfills signing for an already-published release)
#
# Required env:
#   REPO                 registry repo without a tag, e.g. langwatch/langwatch
#   IMAGE_NAME           short name used in SBOM filenames, e.g. langwatch
#   INSPECT_TAG          tag whose multi-arch index is inspected and signed, e.g. 3.4.0 or a247e8e
#   SBOM_DIR             directory to write the *.cdx.json SBOMs into
#   CERT_IDENTITY_REGEX  cosign --certificate-identity-regexp value
#   CERT_OIDC_ISSUER     cosign --certificate-oidc-issuer value
# Optional env:
#   EXTRA_TAGS           space-separated tags that should point at the same index digest;
#                        any whose digest differs is signed separately (e.g. "3.4.0 latest")
set -euo pipefail

: "${REPO:?REPO required (e.g. langwatch/langwatch)}"
: "${IMAGE_NAME:?IMAGE_NAME required (short name for SBOM files)}"
: "${INSPECT_TAG:?INSPECT_TAG required (tag whose index is signed)}"
: "${SBOM_DIR:?SBOM_DIR required}"
: "${CERT_IDENTITY_REGEX:?CERT_IDENTITY_REGEX required}"
: "${CERT_OIDC_ISSUER:?CERT_OIDC_ISSUER required}"
EXTRA_TAGS="${EXTRA_TAGS:-}"

REF="${REPO}:${INSPECT_TAG}"
INSPECT=$(docker buildx imagetools inspect "${REF}" --format '{{ json . }}')

INDEX_DIGEST=$(echo "${INSPECT}" | jq -r '.manifest.digest')
if [ -z "${INDEX_DIGEST}" ] || [ "${INDEX_DIGEST}" = "null" ]; then
  echo "::error::Could not resolve index digest for ${REF}"
  exit 1
fi
echo "Signing multi-arch index ${REPO}@${INDEX_DIGEST}"
cosign sign "${REPO}@${INDEX_DIGEST}"

echo "Verifying index signature for ${REPO}@${INDEX_DIGEST}"
cosign verify "${REPO}@${INDEX_DIGEST}" \
  --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
  --certificate-oidc-issuer "${CERT_OIDC_ISSUER}" > /dev/null

# Equivalent tags should all point at the same multi-arch manifest digest, but assert
# it explicitly so that any registry-side normalization that produces a different digest
# is signed rather than silently leaving an unsigned tag.
for TAG in ${EXTRA_TAGS}; do
  TAG_DIGEST=$(docker buildx imagetools inspect "${REPO}:${TAG}" --format '{{ json . }}' | jq -r '.manifest.digest')
  if [ "${TAG_DIGEST}" != "${INDEX_DIGEST}" ]; then
    echo "::warning::${REPO}:${TAG} digest ${TAG_DIGEST} differs from ${REF} digest ${INDEX_DIGEST}; signing separately"
    cosign sign "${REPO}@${TAG_DIGEST}"
    cosign verify "${REPO}@${TAG_DIGEST}" \
      --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
      --certificate-oidc-issuer "${CERT_OIDC_ISSUER}" > /dev/null
  fi
done

PLATFORMS_JSON=$(echo "${INSPECT}" | jq -c '[.manifest.manifests[] | select(.platform.os != "unknown") | {digest: .digest, os: .platform.os, arch: .platform.architecture}]')
COUNT=$(echo "${PLATFORMS_JSON}" | jq 'length')
if [ "${COUNT}" -eq 0 ]; then
  echo "::error::No platform manifests found in index for ${REF}"
  exit 1
fi

for i in $(seq 0 $((COUNT - 1))); do
  ENTRY=$(echo "${PLATFORMS_JSON}" | jq -c ".[$i]")
  PDIGEST=$(echo "${ENTRY}" | jq -r '.digest')
  POS=$(echo "${ENTRY}" | jq -r '.os')
  PARCH=$(echo "${ENTRY}" | jq -r '.arch')
  PDREF="${REPO}@${PDIGEST}"
  SBOM_FILE="${SBOM_DIR}/${IMAGE_NAME}-${POS}-${PARCH}.cdx.json"

  echo "Generating CycloneDX SBOM for ${PDREF} (${POS}/${PARCH})"
  syft "registry:${PDREF}" -o cyclonedx-json="${SBOM_FILE}"

  echo "Signing platform manifest ${PDREF}"
  cosign sign "${PDREF}"

  echo "Attesting SBOM for ${PDREF}"
  cosign attest --predicate "${SBOM_FILE}" --type cyclonedx "${PDREF}"

  echo "Verifying signature and SBOM attestation for ${PDREF}"
  cosign verify "${PDREF}" \
    --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
    --certificate-oidc-issuer "${CERT_OIDC_ISSUER}" > /dev/null
  cosign verify-attestation "${PDREF}" \
    --type cyclonedx \
    --certificate-identity-regexp "${CERT_IDENTITY_REGEX}" \
    --certificate-oidc-issuer "${CERT_OIDC_ISSUER}" > /dev/null
done
