#!/usr/bin/env bash
# Generates sdk-versions.json from the actual SDK package files.
# Called as a build step so the fallback versions stay in sync.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT="$SCRIPT_DIR/../src/server/sdk-radar/sdk-versions.json"

TS_VERSION=$(node -p "require('$REPO_ROOT/typescript-sdk/package.json').version")
PY_VERSION=$(sed -n 's/^version = "\([^"]*\)".*/\1/p' "$REPO_ROOT/python-sdk/pyproject.toml")

if [[ -z "$TS_VERSION" || "$TS_VERSION" == "undefined" ]]; then
  echo "ERROR: could not read version from typescript-sdk/package.json" >&2
  exit 1
fi
if [[ -z "$PY_VERSION" ]]; then
  echo "ERROR: could not read version from python-sdk/pyproject.toml" >&2
  exit 1
fi

cat > "$OUTPUT" <<JSON
{
  "python-sdk": "$PY_VERSION",
  "typescript-sdk": "$TS_VERSION"
}
JSON
