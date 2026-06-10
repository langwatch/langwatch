#!/usr/bin/env bash
# refresh-dev-s3-env.sh — rotate the S3 SSO credentials in langwatch/.env
#
# AWS SSO session tokens expire ~hourly. When `pnpm dev` against
# runtime-storage-dev starts returning RequestExpired / InvalidToken,
# run this script from anywhere — it logs into SSO, exports fresh
# temporary credentials, and rewrites the S3_ACCESS_KEY_ID /
# S3_SECRET_ACCESS_KEY / S3_SESSION_TOKEN lines in langwatch/.env in
# place. The non-rotating lines (S3_BUCKET_NAME, S3_ENDPOINT,
# S3_REGION) are left alone.
#
# Usage:
#   bash langwatch/scripts/refresh-dev-s3-env.sh
#
# Requirements:
#   - aws CLI installed
#   - ~/.aws/config has a [profile lw-dev-sso] entry (SSO-backed)
#   - You're a member of the lw-dev AWS SSO account

set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-lw-dev-sso}"
ENV_FILE="${ENV_FILE_OVERRIDE:-langwatch/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run from the repo root." >&2
  exit 1
fi

echo "Logging into SSO (profile=$PROFILE)..."
aws sso login --profile "$PROFILE" >/dev/null

echo "Exporting temporary credentials..."
# shellcheck disable=SC1090
eval "$(aws configure export-credentials --profile "$PROFILE" --format env)"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" || -z "${AWS_SESSION_TOKEN:-}" ]]; then
  echo "ERROR: SSO export did not produce all three creds." >&2
  exit 1
fi

# Strip the three rotating lines (preserve bucket/endpoint/region).
sed -i.bak \
  -e '/^S3_ACCESS_KEY_ID=/d' \
  -e '/^S3_SECRET_ACCESS_KEY=/d' \
  -e '/^S3_SESSION_TOKEN=/d' \
  "$ENV_FILE"
rm -f "${ENV_FILE}.bak"

# Append fresh rotating lines.
{
  echo "S3_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
  echo "S3_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
  echo "S3_SESSION_TOKEN=$AWS_SESSION_TOKEN"
} >> "$ENV_FILE"

echo "Refreshed dev S3 SSO credentials in $ENV_FILE"
echo "  Account:  $(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
echo "  Expires:  ~1 hour from now (run this script again on RequestExpired)"
