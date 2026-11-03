#!/bin/sh
# The runtime-only tree, one recipe for the production image and the npx app archive (ADR-180).
#   prune-runtime-tree.sh deps <dir>    <dir> holds the install inputs and every workspace manifest:
#                                       install production dependencies, trim them, keep only node_modules
#   prune-runtime-tree.sh built <dir>   <dir> holds built trees: drop their node_modules and what no process runs
# POSIX sh and find flags busybox, BSD and GNU all share: it runs on Alpine, macOS and Ubuntu.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
usage="usage: prune-runtime-tree.sh deps|built <dir>"
phase=${1:?$usage}
cd "${2:?$usage}"

# Three roles, the backend that hosts two of them and the scenario child the worker spawns;
# @langwatch/ui is not installed, its bundle is built. --filter-prod, not --filter: with --prod alone
# a filtered member's devDependencies are still followed. The image pnpmfile drops the peers that resolve to dev tools (see its header); a hook
# runs only when pnpm resolves, so the lockfile is re-resolved first and the version check fails the
# build on any version the committed lockfile does not name. Dependency build scripts run here.
deps() {
  export pnpm_config_pnpmfile="$here/image.pnpmfile.cjs" CI=true
  committed=$(mktemp)
  cp pnpm-lock.yaml "$committed"
  pnpm install --lockfile-only
  node "$here/check-locked-versions.mjs" "$committed" pnpm-lock.yaml
  rm -f "$committed"
  pnpm install --frozen-lockfile --prod --filter-prod "@langwatch/platform-api..." --filter-prod "@langwatch/worker..." --filter-prod "@langwatch/scenario-child..." --filter-prod "@langwatch/tasks..." --filter-prod "@langwatch/backend..."

  # The installed packages' own weight: source maps, declarations, tests, docs and examples, and the
  # query compiler Prisma ships for every database it supports (this tree talks to PostgreSQL only).
  find node_modules/.pnpm -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} +
  find node_modules/.pnpm -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.md' \) -delete
  find node_modules/.pnpm -type f -name 'query_compiler_*' ! -name '*postgresql*' -delete
  node "$here/check-links.mjs" "$PWD"

  # The Prisma CLI is here for `prisma migrate deploy` (the upgrade runs it) and nothing else. Its entry
  # file needs Studio's data modules and the dev server's state module at load; Studio's browser UI,
  # the dev server's bundled database, the query-plan executor and Studio's graph layout go, with the
  # links that pointed at them.
  rm -rf node_modules/.pnpm/@prisma+studio-core@*/node_modules/@prisma/studio-core/dist/ui \
    node_modules/.pnpm/@prisma+studio-core@*/node_modules/@prisma/studio-core/dist/metafile-*.json \
    node_modules/.pnpm/@prisma+dev@*/node_modules/@prisma/dev/dist/runtime-assets \
    node_modules/.pnpm/@prisma+query-plan-executor@* node_modules/.pnpm/@electric-sql+pglite* node_modules/.pnpm/elkjs@*
  find node_modules/.pnpm -type l \( -path '*/@prisma/query-plan-executor' -o -path '*/@electric-sql/pglite*' -o -path '*/node_modules/elkjs' \) -delete
  node "$here/check-links.mjs" "$PWD"

  # Only node_modules directories are left: the manifests, lockfile and workspace file go (the
  # runtime must carry no pnpm-workspace.yaml, see pnpm_config_verify_deps_before_run), and so do the
  # member directories that got no node_modules. The built trees are laid over these afterwards.
  find . -name node_modules -prune -o ! -type d -exec rm -f {} +
  find . -depth -type d -empty ! -path '*/node_modules/*' -delete
}

# The built trees leave without node_modules: the production install above provides every one, and a
# link left here would replace a production one with one into the development install. Then what no
# process runs: the module halves the browser loads (the api serves the built bundle), tests, specs,
# ADRs, declarations, source maps and the SDKs' sources and examples. Workspace packages nothing links
# to go too; the link check after the trees meet the install fails if any link now points at nothing.
built() {
  find . -name node_modules -type d -prune -exec rm -rf {} +
  find apps/ui/dist/client -name '*.map' -delete
  rm -rf modules/*/browser modules/*/client enterprise/modules/*/browser enterprise/modules/*/client \
    packages/architecture-enforcer packages/oxlint-rules packages/design-system packages/design-system-internal \
    packages/browser packages/browser-host packages/browser-types packages/sim-console packages/test-harness \
    packages/vitest-config packages/webhook-verify packages/ksuid-python
  find sdks/typescript mcp/typescript -mindepth 1 -maxdepth 1 ! -name dist ! -name package.json -exec rm -rf {} +
  find apps packages modules enterprise \
    \( -type d \( -name __tests__ -o -name tests -o -name e2e -o -name specs -o -name adrs -o -name docs -o -name examples \) -o \
    -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name '*.feature' -o -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.tsbuildinfo' -o -name '*.md' \) \) \
    -prune -exec rm -rf {} +
}

case "$phase" in
  deps) deps ;;
  built) built ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
