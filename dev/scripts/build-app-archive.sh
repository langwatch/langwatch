#!/usr/bin/env bash
# Build the prebuilt app `npx @langwatch/server` installs (ADR-180), for the platform it runs on.
#
#   bash dev/scripts/build-app-archive.sh [--out DIR]
#
# Run from a checkout where `pnpm install` and `pnpm run build:server` have run. Writes
# DIR/langwatch-app-<slug>.tar.gz and its .sha256 (DIR defaults to _pack). The slug is the
# release's: linux-amd64, linux-arm64, darwin-amd64 or darwin-arm64, the AI gateway's spellings.
#
# The tree is the production image's: the same workspace manifests are installed for production and
# the same built trees are laid over them, both pruned by infra/docker/prune-runtime-tree.sh. On top
# come the Python sources uv prepares on the user's machine and the tokenizer files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUT="$ROOT/_pack"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --out=*) OUT="${1#--out=}"; shift ;;
    *) echo "✗ unknown argument: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "✗ app archives are built on macOS or Linux, not $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "✗ no app archive for $(uname -m)" >&2; exit 1 ;;
esac
SLUG="$os-$arch"
VERSION="$(node -p "require('./apps/server/package.json').version")"
ARCHIVE="$OUT/langwatch-app-$SLUG.tar.gz"

# What build:server writes. Missing any of them means the archive would ship a tree that cannot boot.
for built in apps/ui/dist/client/index.html \
  apps/scenario-child/dist/server/scenario-child-process.mjs \
  mcp/typescript/dist/create-mcp-server.js \
  packages/prisma-client/src/generated; do
  if [ ! -e "$built" ]; then
    echo "✗ $built missing — run 'pnpm install && pnpm run build:server' first" >&2
    exit 1
  fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/langwatch-app.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
BUILT="$WORK/built"
APP="$WORK/app"
mkdir -p "$BUILT" "$APP"
# bsdtar on macOS would otherwise add AppleDouble `._*` entries for extended attributes.
export COPYFILE_DISABLE=1

# Copies working-tree paths (build output is untracked) from the checkout into a directory.
copy_tree() {
  local dest="$1"
  shift
  tar -cf - --exclude=node_modules --exclude=.env --exclude='.env.*' --exclude=.DS_Store \
    --exclude='*.log' --exclude=.turbo "$@" | (cd "$dest" && tar -xf -)
}

# Copies only the files git tracks under the given paths, so no virtualenv or cache rides along.
copy_tracked() {
  local dest="$1"
  shift
  git -c core.quotePath=false ls-files -z -- "$@" | tar -cf - --null -T - | (cd "$dest" && tar -xf -)
}

echo "→ staging the production install inputs (the image's prod-deps stage)"
cp pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc "$APP/"
copy_tracked "$APP" patches vendor
copy_tracked "$APP" $(git ls-files -- 'mcp/typescript/*package.json' 'packages/*package.json' \
  'modules/*package.json' 'enterprise/*package.json' 'skills/*package.json' 'sdks/typescript/*package.json')
copy_tracked "$APP" dev/tests/agentic-e2e/package.json dev/tests/e2e-stack/package.json \
  tools/seedgen/runner/package.json dev/scripts/package.json \
  apps/worker/package.json apps/api/package.json apps/ui/package.json apps/tasks/package.json \
  apps/backend/package.json apps/scenario-child/package.json
sh infra/docker/prune-runtime-tree.sh deps "$APP"

echo "→ staging the built trees (what the image's runtime stage copies from the builder)"
copy_tree "$BUILT" mcp/typescript sdks/typescript packages modules enterprise \
  apps/worker apps/scenario-child apps/tasks apps/api apps/backend apps/ui/dist/client \
  services/langevals/ts-integration/evaluators.generated.ts feature-map.json
# The npx server is a release build (dev/docs/ARCHITECTURE.md, build stamp).
stamp="$BUILT/packages/config/src/release-build.ts"
sed -i.bak 's/^export const isReleaseBuild: boolean = false;$/export const isReleaseBuild: boolean = true;/' "$stamp"
rm "$stamp.bak"
grep -q '^export const isReleaseBuild: boolean = true;$' "$stamp" || { echo "✗ release stamp not set in $stamp" >&2; exit 1; }
sh infra/docker/prune-runtime-tree.sh built "$BUILT"

echo "→ laying the built trees over the production install"
(cd "$BUILT" && tar -cf - .) | (cd "$APP" && tar -xf -)
node infra/docker/check-links.mjs "$APP"

# What the npx install adds to the image's tree: the Python sources uv prepares on the user's
# machine, and the script a checkout uses to fill its tokenizer cache.
copy_tracked "$APP" services/langevals sdks/python/pyproject.toml sdks/python/README.md sdks/python/src \
  dev/scripts/download-tiktoken-encodings.mjs LICENSE.md
find "$APP/services/langevals" "$APP/sdks/python" -type d \( -name tests -o -name __pycache__ \) -prune -exec rm -rf {} +

# The tokenizer files, as the image fetches them at build: tiktoken/ for the app (TIKTOKENS_PATH)
# and tiktoken-python/ for LangEvals (TIKTOKEN_CACHE_DIR), so a first start downloads neither.
(cd "$APP/modules/trace/process" && node "$ROOT/dev/scripts/download-tiktoken-encodings.mjs" \
  "$APP/tiktoken" "$APP/tiktoken-python")

# Written last: the CLI treats a tree without it as an interrupted install.
printf '%s %s\n' "$VERSION" "$SLUG" > "$APP/.langwatch-app-complete"

echo "→ packing $ARCHIVE"
tar -C "$APP" -czf "$ARCHIVE" .
if command -v sha256sum >/dev/null 2>&1; then
  hash="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
else
  hash="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"
fi
printf '%s  %s\n' "$hash" "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
echo "→ built $(basename "$ARCHIVE") ($(du -h "$ARCHIVE" | cut -f1)), sha256 $hash"
