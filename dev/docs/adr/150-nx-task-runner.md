# ADR-150: Nx as the workspace task runner

**Date:** 2026-09-18

**Status:** Accepted

## Context

The repository is a single pnpm workspace of 209 packages (ADR-076). Every
package declares the same two scripts — `typecheck` (a `tsc -b` over composite
project references) and `test` (`vitest run`) — and packages resolve each other
through `exports` entries whose `default` condition points at TypeScript
source, not at build output. A dependency's source is therefore an input to its
dependents' tests directly, with no build step in between.

Nothing orchestrated those scripts. Three mechanisms stood in for a task
runner, each with a different failure mode:

- `pnpm -r --filter <globs> test` fans out over every package and re-runs all
  of them on every invocation. There is no memory of what already passed, so an
  unchanged package is re-tested for as long as the workspace exists.
- The root `typecheck` is one `tsc -b` across the whole project graph. It holds
  2.3–3.5 GiB and every core for the duration, which is why it is routed
  through haven's slot queue in agent shells: the cost is not the type checking
  but that the unit of work is the entire workspace, always.
- CI names the packages to test by hand. `langwatch-app-ci.yml` carries roughly
  forty `pnpm --filter <package> run test` steps, added one at a time as
  packages appeared. The list is maintained by memory; a package added without
  a step is silently untested, and a package whose dependency changed is tested
  only if someone remembered to list it.

All three share one gap: nothing in the repository knows which packages a
change actually reaches. The dependency graph exists — it is the `workspace:*`
edges in 209 package.json files — but no tool reads it to decide what to run.

## Decision

We will adopt Nx as the workspace task runner, configured to read the pnpm
workspace it already has rather than to restructure it.

Nx infers its projects from `pnpm-workspace.yaml` and its targets from the
`scripts` block of each package.json. No package gains a `project.json`, no
script is rewritten as an Nx executor, and no generator owns scaffolding —
`modules/catalogue.json` and `pnpm generate:modules` remain how a module is
installed. The whole configuration is one `nx.json` at the root declaring
cache inputs, outputs and target ordering.

Task inputs are declared so that the cache is correct for a source-resolving
workspace. `typecheck` and `test` both take `["default", "^default"]`: a
package's own files and the files of every package it depends on. This is the
property that matters here — because tests import dependency source directly,
a cache keyed only on the package's own files would replay a stale pass after
a dependency changed underneath it. `typecheck` additionally declares
`dependsOn: ["^typecheck"]` and `outputs: ["{projectRoot}/dist"]`, so the
declaration files a dependent's `tsc -b` reads are built, and cached, before it
runs.

`test:integration` is left uncached deliberately. Those suites read Postgres,
ClickHouse and Redis, and their result is a function of datastore state that no
input declaration describes. A cache over them would key on code alone and
replay a pass that the data no longer supports.

The existing root scripts are unchanged. `test`, `typecheck`, `lint`, `build`
and every `dev:*` entry keep the exact filter sets that CI, haven and the
documentation already invoke. Nx is added beside them as `test:all`,
`test:affected`, `typecheck:all`, `typecheck:affected`, `build:affected`,
`lint:affected` and `graph`.

## Rationale / Trade-offs

Nx was configured in its inferred-target mode rather than its project-oriented
mode. The alternative — a `project.json` per package with Nx executors
replacing the scripts — would have put Nx in charge of how packages are
described, which is territory this repository has already spoken for: the
feature-layout grammar, the architecture-enforcer's policy registry and the
module catalogue each define part of what a package is and where its files go.
A second system describing the same packages would be a second authority, and
the first thing it would disagree with is the linter, which CLAUDE.md names as
the truth. Inferred targets avoid the question entirely: the package.json
scripts remain the definition of what a package can do, and Nx only decides
when to run them and whether it may skip.

Keeping the old root scripts is a deliberate cost. It means two ways to run the
tests exist, and the filter sets can drift apart. The alternative was to
repoint `test` at `nx run-many -t test`, which does not mean the same thing:
the current root `test` covers `packages/`, `modules/`, and the enterprise
modules and composition packages, and deliberately excludes the applications,
the SDK and the e2e suites. Silently widening it would have changed what
`pnpm test` means for everyone mid-branch. The cutover is a separate decision
with a separate blast radius, and it should be made against a green tree.

The cache is local-only. No Nx Cloud account is configured and `nxCloudId` is
absent, so nothing about this change sends source or task metadata anywhere.
Remote caching is a later decision with its own trade-offs.

## Consequences

Repeated work stops being repeated. A cached package test replays in
approximately 20 ms against approximately 6 s to run it, and the replay is
correct across dependency edges: touching a dependency's source invalidates its
dependents and restoring it restores the hit.

CI gains the ability to stop naming packages by hand. `nx affected -t test`
derives the same list from the graph, which closes the gap where a new package
or a changed dependency is silently untested. This ADR does not make that
change — the forty-odd steps in `langwatch-app-ci.yml` are still the list CI
runs — but it is now a deletion rather than a rewrite.

The workspace-wide `tsc -b` stops being the only way to type check. Because
`typecheck` is per-package, ordered and cached, an incremental run touches only
what a change reached, rather than holding the whole graph in one compiler
process. The root `typecheck` script and its slot-queue routing are unchanged
for the full cold build, where one `tsc -b` is still the cheaper shape.

`.nx/cache` and `.nx/workspace-data` are machine-local derived state and are
git-ignored. `.nxignore` keeps nested agent worktrees under `.claude/worktrees`
out of the graph; they are separate checkouts carrying their own package.json
files, and without the exclusion Nx reads them as projects of this workspace.

## References

- Related ADRs: [076](./076-single-pnpm-workspace.md) (single pnpm workspace),
  [143](./143-formatting.md)
- Configuration: `nx.json`, `.nxignore`
