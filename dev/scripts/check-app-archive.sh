#!/usr/bin/env bash
# Checks an app archive built by dev/scripts/build-app-archive.sh before it ships (ADR-180).
#
#   bash dev/scripts/check-app-archive.sh _pack/langwatch-app-<slug>.tar.gz
#
# Verifies the checksum file, a size ceiling, the paths a boot needs, the paths that must never ship
# (secrets, development tools, tests, source maps), the release stamp, and that every link inside
# the extracted tree resolves. Fails closed: the archive is public.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVE="${1:?usage: check-app-archive.sh <archive.tar.gz>}"
# Raise deliberately, with the reason in the commit: growth here is every user's first download.
MAX_MB=500

fail() {
  echo "✗ $*" >&2
  exit 1
}

[ -f "$ARCHIVE" ] || fail "no archive at $ARCHIVE"
[ -f "$ARCHIVE.sha256" ] || fail "no checksum file at $ARCHIVE.sha256"
expected="$(cut -d' ' -f1 < "$ARCHIVE.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch: file says $expected, archive is $actual"
echo "→ verified: the checksum file matches"

size_bytes="$(wc -c < "$ARCHIVE" | tr -d ' ')"
echo "→ archive size: $((size_bytes / 1024 / 1024)) MB"
[ "$size_bytes" -le $((MAX_MB * 1024 * 1024)) ] || fail "archive is larger than $MAX_MB MB"

TREE="$(mktemp -d "${TMPDIR:-/tmp}/langwatch-app-check.XXXXXX")"
trap 'rm -rf "$TREE"' EXIT
tar -xzf "$ARCHIVE" -C "$TREE"

required=(
  # Written last by the builder; the CLI refuses a tree without it.
  .langwatch-app-complete
  # The one process the CLI spawns (api and worker together), the task launcher, and their trees.
  apps/backend/package.json
  apps/backend/src/main.ts
  apps/backend/node_modules
  apps/api/src/main.ts
  apps/api/prisma.config.ts
  apps/worker/src/main.ts
  apps/tasks/package.json
  apps/tasks/src/main.ts
  # The browser bundle the api serves, and the scenario child the worker spawns per run.
  apps/ui/dist/client/index.html
  apps/scenario-child/dist/server/scenario-child-process.mjs
  # Generated files and what the upgrade applies.
  packages/prisma-client/src/generated
  packages/prisma-client/prisma.config.ts
  packages/prisma-client/prisma/schema.prisma
  packages/prisma-client/prisma/migrations
  packages/clickhouse-migrations/migrations
  packages/upgrade/releases
  modules/model-provider/contract/src/catalog
  mcp/typescript/dist/create-mcp-server.js
  feature-map.json
  node_modules/.pnpm
  # What uv prepares on the user's machine, and the tokenizer download script.
  services/langevals/pyproject.toml
  services/langevals/uv.lock
  sdks/python/pyproject.toml
  dev/scripts/download-tiktoken-encodings.mjs
  # The tokenizer files, so a first start downloads none (app and LangEvals).
  tiktoken/cl100k_base.tiktoken
  tiktoken-python
  LICENSE.md
)
for path in "${required[@]}"; do
  [ -e "$TREE/$path" ] || fail "archive is missing $path"
done
echo "→ verified: every path a boot needs is present"

listing="$(mktemp)"
ours="$(mktemp)"
(cd "$TREE" && find . \( -type f -o -type l \) | sed 's|^\./||') > "$listing"
# Our own files: what a registry package ships under node_modules is not ours to judge.
{ grep -vE '(^|/)node_modules/' "$listing" || true; } > "$ours"
check_absent() {
  local label="$1" pattern="$2" list="${3:-$listing}" found
  found="$(grep -E "$pattern" "$list" | grep -vE '(^|/)\.env\.example$' | head -n 10 || true)"
  [ -z "$found" ] || fail "archive contains $label:"$'\n'"$found"
}
check_absent "secret-shaped files" '(^|/)\.env($|\.)|\.(pem|key|p12|pfx)$|(^|/)\.npmrc$|(^|/)id_(rsa|ed25519)' "$ours"
# The SDK and MCP bundles keep their maps, as in the image; the prune drops every other one.
check_absent "source maps" '^(apps|packages|modules|enterprise|node_modules)/.*\.map$'
check_absent "tests" '^(apps|packages|modules|enterprise|services)/.*((^|/)(__tests__|tests?)/|\.(test|spec)\.[cm]?[jt]sx?$)' "$ours"
check_absent "Python caches or virtualenvs" '(^|/)(__pycache__|\.venv)/'
check_absent "the workspace definition (pnpm would try to install)" '^pnpm-workspace\.yaml$'
check_absent "development tools" '^node_modules/\.pnpm/(vitest|@vitest\+|oxlint|@oxlint\+|oxfmt|@playwright\+test)@'
rm -f "$listing" "$ours"
echo "→ verified: no secrets, tests, source maps or development tools"

grep -q '^export const isReleaseBuild: boolean = true;$' "$TREE/packages/config/src/release-build.ts" \
  || fail "the archive is not stamped as a release build"
echo "→ verified: release build stamp"

node "$ROOT/infra/docker/check-links.mjs" "$TREE"
echo "✓ $(basename "$ARCHIVE") is fit to ship"
