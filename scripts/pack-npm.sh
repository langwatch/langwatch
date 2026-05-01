#!/usr/bin/env bash
#
# Pack the @langwatch/server npm tarball with the Apache-2.0 LICENSE in place.
#
# WHY: the GitHub repo as a whole is licensed BSL 1.1 (see /LICENSE.md, the
# file GitHub auto-detects for repo display). The @langwatch/server NPM
# package is licensed Apache-2.0 (see /LICENSE-NPM.txt). npm auto-includes
# any LICENSE-shaped file at the package root, so we can't just exclude
# /LICENSE.md from the tarball — we have to swap its contents at pack time.
#
# This script does the swap, runs `pnpm pack`, and restores the BSL file
# whether pack succeeds or fails (via trap on EXIT). It is safe to interrupt;
# a leftover LICENSE.md.bak (after a hard kill) is recoverable with
# `mv LICENSE.md.bak LICENSE.md`.
#
# Used by:
#   - .github/workflows/npx-server-publish.yml (CI publish)
#   - manual local publish (smith / julia run this directly)
#
# Args: forwarded to `pnpm pack` (e.g. `--pack-destination _pack`).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

readonly LICENSE_REPO="$ROOT/LICENSE.md"
readonly LICENSE_NPM="$ROOT/LICENSE-NPM.txt"

# IMPORTANT: keep the backup OUTSIDE the repo. npm has a hardcoded
# auto-include rule for any file matching LICENSE/LICENCE (and variants
# like LICENSE.md.bak), so a backup at repo root would leak into the
# published tarball regardless of .npmignore. /tmp avoids it entirely.
LICENSE_BAK="$(mktemp -t langwatch-license.XXXXXX)"
readonly LICENSE_BAK

if [ ! -f "$LICENSE_REPO" ]; then
  echo "✗ $LICENSE_REPO does not exist — aborting"
  exit 1
fi
if [ ! -f "$LICENSE_NPM" ]; then
  echo "✗ $LICENSE_NPM does not exist — Apache-2.0 source missing"
  exit 1
fi

restore_license() {
  if [ -f "$LICENSE_BAK" ]; then
    mv "$LICENSE_BAK" "$LICENSE_REPO"
    echo "↺ restored $LICENSE_REPO from $LICENSE_BAK"
  fi
}
trap restore_license EXIT

echo "→ swapping $LICENSE_REPO with Apache-2.0 for the npm tarball"
cp "$LICENSE_REPO" "$LICENSE_BAK"
cp "$LICENSE_NPM" "$LICENSE_REPO"

cd "$ROOT"
echo "→ running: pnpm pack $*"
pnpm pack "$@"
