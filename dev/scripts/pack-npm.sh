#!/usr/bin/env bash
#
# Pack the @langwatch/server npm package: the CLI and nothing else (ADR-180).
#
# The package holds dist/cli.cjs, package.json, README.md and LICENSE.md. The app the CLI runs ships
# separately, one prebuilt archive per platform on the GitHub release (dev/scripts/build-app-archive.sh),
# and the CLI's `app` predep installs it. Args are forwarded to `pnpm pack`
# (e.g. `--pack-destination _pack`). `--stage-to DIR` stages into an empty DIR and stops before the
# pack, so a person or a test can read exactly what would ship.
#
# Used by .github/workflows/npx-server-publish.yml, npx-server-smoke.yml and a manual publish.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

STAGE_TO=""
STAGE_TO_GIVEN=0
DEST="$ROOT"
PACK_ARGS=()
prev_arg=""
for arg in "$@"; do
  case "$prev_arg" in
    --stage-to) STAGE_TO="$arg"; prev_arg=""; continue ;;
    --pack-destination) DEST="$arg"; prev_arg=""; continue ;;
  esac
  case "$arg" in
    --stage-to) prev_arg="--stage-to"; STAGE_TO_GIVEN=1 ;;
    --stage-to=*) STAGE_TO="${arg#--stage-to=}"; STAGE_TO_GIVEN=1 ;;
    --pack-destination) prev_arg="--pack-destination" ;;
    --pack-destination=*) DEST="${arg#--pack-destination=}" ;;
    *) PACK_ARGS+=("$arg") ;;
  esac
done
# Tracked apart from the value, so `--stage-to=` and `--stage-to ""` are refused rather than
# quietly packing to a temporary directory.
if [ "$STAGE_TO_GIVEN" -eq 1 ] && [ -z "$STAGE_TO" ]; then
  echo "✗ --stage-to needs a directory" >&2
  exit 1
fi
set -- ${PACK_ARGS[@]+"${PACK_ARGS[@]}"}

# The CLI bundle is the package; without it `bin` dangles and fails at `npx` time.
if [ ! -f "apps/server/dist/cli.cjs" ]; then
  echo "✗ apps/server/dist/cli.cjs missing — run 'pnpm build:cli' first" >&2
  exit 1
fi

if [ -n "$STAGE_TO" ]; then
  # An empty directory only: anything already there would read as staged and ship.
  mkdir -p "$STAGE_TO"
  if [ -n "$(ls -A "$STAGE_TO" 2>/dev/null)" ]; then
    echo "✗ --stage-to needs an empty directory, and $STAGE_TO is not empty" >&2
    exit 1
  fi
  STAGE="$(cd "$STAGE_TO" && pwd)"
else
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/langwatch-pack.XXXXXX")"
  trap 'rm -rf "$STAGE"' EXIT
fi

mkdir -p "$STAGE/dist"
cp "$ROOT/apps/server/dist/cli.cjs" "$STAGE/dist/cli.cjs"
# npm includes these at the package root whatever `files` says: the Apache-2.0 licence and the readme.
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE.md" "$STAGE/LICENSE.md"

# The published manifest is apps/server's, cut to the CLI. cli.cjs bundles every import, so the
# registry install needs no workspace member (all private: E404 at npx time) and no build tooling.
# Only the bin entry point ships: `./task` named source the package no longer carries.
node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync("apps/server/package.json", "utf8"));
  pkg.bin = { "langwatch-server": "dist/cli.cjs" };
  pkg.files = ["dist"];
  pkg.main = "dist/cli.cjs";
  pkg.exports = { ".": "./dist/cli.cjs" };
  delete pkg.scripts;
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies ?? {}).filter(
      ([, spec]) => !(typeof spec === "string" && spec.startsWith("workspace:")),
    ),
  );
  delete pkg.devDependencies;
  fs.writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + "\n");
' "$STAGE/package.json"

# Guard: the published manifest names no workspace member and no devDependencies. Every member is
# private, so a registry install of one fails with E404 before the CLI runs. Only from a git
# checkout, where the tracked manifests say which names are workspace members.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  node -e '
    const fs = require("node:fs");
    const { execFileSync } = require("node:child_process");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const members = new Set();
    const tracked = execFileSync("git", ["ls-files", "--", "*package.json"], { encoding: "utf8" });
    for (const path of tracked.split("\n").filter(Boolean)) {
      try {
        const name = JSON.parse(fs.readFileSync(path, "utf8")).name;
        if (name) members.add(name);
      } catch {}
    }
    const problems = [];
    if (pkg.devDependencies !== undefined) problems.push("devDependencies");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (members.has(name)) problems.push(`${field}.${name} (a workspace member)`);
      }
    }
    if (problems.length > 0) {
      console.error("✗ the published package.json names what a registry install cannot fetch:");
      for (const problem of problems) console.error(`  ${problem}`);
      process.exit(1);
    }
  ' "$STAGE/package.json"
  echo "→ verified: the published package.json names no workspace member and no devDependencies"
fi

if [ -n "$STAGE_TO" ]; then
  echo "→ --stage-to: staged at $STAGE, stopping before the pack"
  exit 0
fi

# pnpm pack rewrites each `catalog:` specifier to its version only when the packing directory carries
# the catalogs. Only those sections are copied, and `files` keeps the file out of the package.
if [ -f "$ROOT/pnpm-workspace.yaml" ]; then
  awk '/^(catalog|catalogs):/ { keep = 1; print; next } /^[^[:space:]#]/ { keep = 0 } keep' \
    "$ROOT/pnpm-workspace.yaml" > "$STAGE/pnpm-workspace.yaml"
fi

# Absolute, and outside the staging directory the EXIT trap deletes: the pack runs from there.
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
echo "→ running: pnpm pack --pack-destination $DEST $*"
cd "$STAGE"
pnpm pack --pack-destination "$DEST" "$@"

tarball="$(ls -t "$DEST"/langwatch-server-*.tgz 2>/dev/null | head -n1 || true)"
[ -n "$tarball" ] || { echo "✗ pack produced no tarball in $DEST" >&2; exit 1; }

# The package is exactly the CLI. Listed into a file, never `tar | grep -q`: grep exiting early
# SIGPIPEs GNU tar, which fails the pipeline under pipefail on Linux only.
listing="$(mktemp)"
tar -tzf "$tarball" | grep -v '/$' | sed 's|^package/||' | LC_ALL=C sort > "$listing"
expected="$(printf '%s\n' LICENSE.md README.md dist/cli.cjs package.json)"
if [ "$(cat "$listing")" != "$expected" ]; then
  echo "✗ the package must hold exactly the CLI; it holds:" >&2
  cat "$listing" >&2
  rm -f "$listing"
  exit 1
fi
rm -f "$listing"
echo "→ verified: the package holds dist/cli.cjs, package.json, README.md and LICENSE.md"

if tar -xzO -f "$tarball" package/package.json | grep -E '"(workspace|catalog):' >/dev/null; then
  echo "✗ the tarball's package.json still names a workspace: or catalog: specifier" >&2
  exit 1
fi
echo "→ verified: tarball package.json carries no workspace: or catalog: specifiers"
