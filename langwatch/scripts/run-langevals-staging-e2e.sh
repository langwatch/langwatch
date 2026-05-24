#!/usr/bin/env bash
# Run the langevals S3-staging end-to-end test against real lw-dev AWS S3.
#
# What it proves:
#   - stagedLangevalsFetch (TS) → real S3 PUT → presigned GET → langevals
#     middleware fetch → route handler → response. Both inline and staged
#     paths, both evaluator and topic-clustering kinds.
#
# Skipped in CI: GH Actions doesn't have shared dev S3 credentials and the
# test spawns a Python subprocess via `uv`. Run locally with lw-dev SSO
# refreshed (`aws sso login --profile lw-dev-sso`) or any other profile
# that can write to `runtime-storage-dev`.
#
# Usage:
#   bash langwatch/scripts/run-langevals-staging-e2e.sh
#
# Override the profile via AWS_PROFILE=...; override the bucket via
# LANGEVALS_E2E_BUCKET=...; override the threshold via
# LANGEVALS_STAGING_THRESHOLD_BYTES=... (default 200 so even tiny payloads
# stage and we exercise the S3 path with no test data shaping).

set -euo pipefail

PROFILE="${AWS_PROFILE:-lw-dev}"
BUCKET="${LANGEVALS_E2E_BUCKET:-runtime-storage-dev}"
REGION="${AWS_REGION:-eu-central-1}"

if [[ ! -f langwatch/package.json ]]; then
  echo "ERROR: run this from the repo root" >&2
  exit 1
fi

echo "Resolving AWS credentials from profile '$PROFILE'..."
eval "$(aws --profile "$PROFILE" configure export-credentials --format env)"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "ERROR: no credentials returned for profile $PROFILE" >&2
  exit 1
fi

UV_BIN="${UV_BIN:-$(command -v uv || true)}"
if [[ -z "$UV_BIN" ]]; then
  echo "ERROR: uv not on PATH; install via 'pyenv install uv' or set UV_BIN" >&2
  exit 1
fi

export LANGEVALS_E2E_ENABLED=1
export LANGEVALS_STAGING_THRESHOLD_BYTES="${LANGEVALS_STAGING_THRESHOLD_BYTES:-200}"
export EVAL_MAX_PAYLOAD_BYTES="${EVAL_MAX_PAYLOAD_BYTES:-20000000}"
export TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES="${TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES:-200000000}"
export LANGEVALS_STAGING_TTL_SECONDS="${LANGEVALS_STAGING_TTL_SECONDS:-600}"
export S3_BUCKET_NAME="$BUCKET"
export S3_REGION="$REGION"
export S3_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export S3_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export S3_SESSION_TOKEN="${AWS_SESSION_TOKEN:-}"
export UV_BIN

echo "bucket=$BUCKET threshold=$LANGEVALS_STAGING_THRESHOLD_BYTES uv=$UV_BIN"
echo "Spawning langevals + running staged-payload e2e..."

cd langwatch
exec pnpm vitest run src/server/langevals/__tests__/stagedFetch.e2e.test.ts --reporter verbose
