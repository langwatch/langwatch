#!/usr/bin/env bash
# Ensure langwatch/.env has the three AI Gateway secrets that the env validator
# requires (>= 32 chars). Without them, the app crashloops on startup with
# "Invalid environment variables: LW_GATEWAY_INTERNAL_SECRET, LW_GATEWAY_JWT_SECRET,
# LW_VIRTUAL_KEY_PEPPER must contain at least 32 character(s)" and a fresh
# `make dev` / `make quickstart` is dead on arrival (issue #3902).
#
# Behavior:
#   - Idempotent: only generates a value when the existing one is missing or empty.
#   - Non-destructive: never overwrites a non-empty value.
#   - Clearly logged: every generated secret prints its name (NOT the value).
#
# Skipped entirely when langwatch/.env doesn't exist — the env-files check
# upstream catches that case with a friendlier message.
set -euo pipefail

# Resolve langwatch/.env relative to this script (langwatch/scripts/...).
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

# Skip if .env hasn't been created yet — the env-files check fires first
# and points the user at .env.example, which is more helpful than this
# script generating secrets into a file that doesn't exist.
[ -f "$ENV_FILE" ] || exit 0

REQUIRED_SECRETS=(
  LW_GATEWAY_INTERNAL_SECRET
  LW_GATEWAY_JWT_SECRET
  LW_VIRTUAL_KEY_PEPPER
)

# is_empty_or_missing KEY — return 0 if KEY is absent OR set to an empty
# value in $ENV_FILE, 1 if set to a non-empty value. Matches unquoted,
# single-quoted, and double-quoted forms.
is_empty_or_missing() {
  local key="$1"
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    return 0
  fi
  if grep -qE "^${key}=([\"']?[\"']?[[:space:]]*)?$" "$ENV_FILE"; then
    return 0
  fi
  return 1
}

# generate_one — write a 64-hex-char value via openssl (matches the cadence
# documented in langwatch/.env.example and CLAUDE.md).
generate_one() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: openssl not found — cannot auto-generate AI Gateway secrets." >&2
    echo "       Install openssl, or set the three vars manually in $ENV_FILE." >&2
    exit 1
  fi
  openssl rand -hex 32
}

generated=0
for key in "${REQUIRED_SECRETS[@]}"; do
  if is_empty_or_missing "$key"; then
    value=$(generate_one)
    if grep -qE "^${key}=" "$ENV_FILE"; then
      # In-place replace empty assignment (handles unquoted, '=""', "=''").
      # Use a temp file so a partial write can't corrupt .env.
      tmp=$(mktemp)
      awk -v k="$key" -v v="$value" '
        $0 ~ "^"k"=" { print k "=" v; next }
        { print }
      ' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
    else
      printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
    printf '  generated %s (32 random hex bytes)\n' "$key"
    generated=$((generated + 1))
  fi
done

if [ "$generated" -gt 0 ]; then
  printf 'Wrote %s AI Gateway secret(s) to %s.\n' "$generated" "$ENV_FILE"
  printf 'In production these come from terraform → AWS Secrets Manager (see /ai-gateway/self-hosting/environment-variables for rotation SOP).\n'
fi
