#!/bin/bash
# Upload content-hashed frontend assets to the immutable, commit-prefixed CDN
# bucket (CloudFront over S3). See ADR-038.
#
# The web app's chunks carry content-hash filenames and, from ADR-038, resolve
# against a runtime base of the form:
#
#     https://<cdn-host>/<commit-sha>/assets/<hash>.js
#
# This script syncs `dist/client/assets/` into `s3://<bucket>/<commit-sha>/assets/`.
# Two invariants make a rolling deploy safe:
#   1. NEVER `--delete` — a previous build's prefix must survive so a browser
#      that loaded the old shell can still fetch its (old-hash) chunks.
#   2. Immutable cache — every object is content-addressed under a per-build
#      prefix, so it can be cached forever.
#
# Old prefixes are reaped by an S3 lifecycle rule (infra repo), configured to
# retain them well beyond the longest realistic browser-tab lifetime.
#
# Usage:
#   BUCKET=langwatch-cdn SHA=$(git rev-parse HEAD) \
#     langwatch/scripts/upload-assets-to-cdn.sh [--dry-run]
#
# Env:
#   BUCKET      (required) S3 bucket name backing the CDN.
#   SHA         (required) Commit sha used as the immutable path prefix.
#   DIST        (optional) Client build dir. Default: dist/client (cwd-relative).
#   AWS_REGION  (optional) Passed through to the AWS CLI.

set -euo pipefail

: "${BUCKET:?set BUCKET to the CDN S3 bucket name}"
: "${SHA:?set SHA to the commit sha used as the immutable path prefix}"

DIST="${DIST:-dist/client}"
ASSETS_DIR="${DIST}/assets"
DEST="s3://${BUCKET}/${SHA}/assets"

if [[ ! -d "${ASSETS_DIR}" ]]; then
  echo "error: ${ASSETS_DIR} not found — run \`pnpm build\` first" >&2
  exit 1
fi

DRY_RUN=()
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=(--dryrun)
  echo "[dry-run] no objects will be written"
fi

echo "Syncing ${ASSETS_DIR} -> ${DEST} (immutable, no delete)"

# --size-only avoids re-uploading unchanged content-hashed files on a retry;
# because filenames are content-addressed, identical name ⇒ identical bytes.
# Deliberately no --delete: older builds' prefixes must remain reachable.
aws s3 sync "${ASSETS_DIR}" "${DEST}" \
  "${DRY_RUN[@]}" \
  --size-only \
  --no-progress \
  --cache-control "public, max-age=31536000, immutable"

echo "Done. Set LANGWATCH_ASSET_BASE / app.assetBase to:"
echo "  https://<cdn-host>/${SHA}/"
