#!/usr/bin/env bash
# Ensure .env has the three AI Gateway secrets that the env validator
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
# Skipped entirely when .env doesn't exist — the env-files check
# upstream catches that case with a friendlier message.
set -euo pipefail

# The contributor environment, at the workspace root — two levels up from
# dev/scripts. It was three when this script lived in the platform application's
# own scripts/ directory; copying it here without changing the depth pointed it
# one directory ABOVE the checkout, where it found no .env and exited 0 saying
# nothing. That is the failure this whole script exists to prevent, so the
# resolved path is printed on every write.
ENV_FILE="$(cd "$(dirname "$0")/../.." && pwd)/.env"

# The shared key reader/writer, also used by ensure-langy-dev-env.sh.
. "$(cd "$(dirname "$0")" && pwd)/lib/env-file-keys.sh"

# Skip if .env hasn't been created yet — the env-files check fires first
# and points the user at .env.example, which is more helpful than this
# script generating secrets into a file that doesn't exist.
[ -f "$ENV_FILE" ] || exit 0

REQUIRED_SECRETS=(
  LW_GATEWAY_INTERNAL_SECRET
  LW_GATEWAY_JWT_SECRET
  LW_VIRTUAL_KEY_PEPPER
)

# generate_one — write a 64-hex-char value via openssl (matches the cadence
# documented in .env.example and CLAUDE.md).
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
  if env_file_key_is_empty_or_missing "$ENV_FILE" "$key"; then
    # Assigned first, not passed inline: `exit` inside a command substitution
    # ends only the subshell, so an inline call would write an empty secret
    # when openssl is missing instead of stopping.
    value=$(generate_one)
    env_file_set_key "$ENV_FILE" "$key" "$value"
    printf '  generated %s (32 random hex bytes)\n' "$key"
    generated=$((generated + 1))
  fi
done

if [ "$generated" -gt 0 ]; then
  printf 'Wrote %s AI Gateway secret(s) to %s.\n' "$generated" "$ENV_FILE"
  printf 'In production these come from terraform → AWS Secrets Manager (see /ai-gateway/self-hosting/environment-variables for rotation SOP).\n'
fi
