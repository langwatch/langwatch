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
workspace. `typecheck` and `test` both take `["default", "^production"]`: a
package's own files and the non-test files of every package it depends on
(`production` is `default` minus `*.test.*` and the vitest configs; `__tests__`
helpers stay, because `./testing` exports reach them). This is the
property that matters here — because tests import dependency source directly,
a cache keyed only on the package's own files would replay a stale pass after
a dependency changed underneath it. `typecheck` declares `outputs: ["{projectRoot}/dist"]` and no `dependsOn`
(amended 2026-09-30): each package's `tsc -b` builds the references it reads
itself, and the workspace graph has cycles that `^typecheck` turned into a
refused task graph. Parallel tasks may rebuild a shared reference at once.

`test:integration` is left uncached deliberately. Those suites read Postgres,
ClickHouse and Redis, and their result is a function of datastore state that no
input declaration describes. A cache over them would key on code alone and
replay a pass that the data no longer supports.

The existing root scripts are unchanged. `test`, `typecheck`, `lint`, `build`
and every `dev:*` entry keep the exact filter sets that CI, haven and the
documentation already invoke. Nx is added beside them as `test:all`,
`test:affected`, `typecheck:all`, `typecheck:affected`, `build:affected`,
`lint:changed` and `graph`.

Oxlint is a per-project `lint` target and type-aware oxlint a `lint:types` one
(amended 2026-09-30). `dev/nx/lint-plugin.mjs` infers `lint` for every workspace
member and `lint:types` for every TypeScript one;
`lint` takes `["default", "^production", "lintGlobals"]`, where `lintGlobals` also names
what the cross-file rules read outside a project (`modules/catalogue.json`, module
`package.json` files, the published OpenAPI document, the plugin config), so editing
one of them re-lints every project and editing a file re-lints its project and dependents.
The root `pnpm lint` is `dev/nx/lint.mjs`: `nx run-many -t lint` plus one oxlint run over
the files outside every project. A project with a `lint` script of its own (the
architecture enforcer, the SDK's eslint) keeps it, because Nx lets a package.json script
outrank a plugin; the runner excludes those two from the target and the outside-files run
covers them. `lint:changed` and CI's PR step run `nx affected` (`--files` from the
working copy and branch, or `--base`); a changed-only run misses a finding that
only appears when an unrelated file changes and no input above names it.

`lint:types` takes the same inputs and no `dependsOn`, because workspace imports
resolve to source through `exports` and tsgolint reads no emitted `.d.ts`. The
root `lint` is not type-aware. The architecture enforcer's own `lint` script reads
the whole tree, so it is never cached: its own project's files cannot describe
its result.

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

## Amendment, 2026-09-30: one cache for every checkout, and what makes it trustworthy

**The cache is already shared.** Nx 23 keeps one cache and its index per user
and workspace identity, at `~/.nx/<id>/{cache,databases}`, so every worktree of
this repository reads and writes the same entries. `.nx/cache` in a checkout is
only the fallback when `~/.nx` cannot be written. Nothing sets the location:
`NX_CACHE_DIRECTORY`, `NX_WORKSPACE_DATA_DIRECTORY` or a `cacheDirectory` in
`nx.json` each turn sharing off and leave the index per checkout, so a second
worktree misses on entries the first wrote. haven's overlay pins that it emits
none of them (`TestOverlayLeavesNxCacheLocationToNx`), except for an untrusted
checkout, which gets a private cache and no daemon
(`TestOverlayGivesUntrustedCheckoutAPrivateNxCache`). `maxCacheSize` caps the
shared cache at 10 GB, least recently used first. `.claude/settings.json`
already grants the agent sandbox `~/.nx`.

**Prepare reads the cache.** The two slow, declarable steps of preparing a
checkout are Nx targets with honest inputs and outputs:

- `@langwatch/prisma-client:prisma:generate`: the schema, `prisma.config.ts`
  and the table-catalogue script in; `src/generated` and `src/table-catalogue.ts`
  out. `start:prepare:files` runs it through `nx run`.
- `build` for the SDK, the MCP server, `ksuid` and `mail`. The SDK's build
  copies files from outside its package (the evaluator catalogue, the trace
  schemas, the skills, the OpenAPI document, the redaction sources), so its
  entry in `targetDefaults` names each of them and treats
  `src/internal/generated` as output, not input. `ensure-built` keeps its mtime
  fast path and, when a build is due, runs it through `nx run` when the
  workspace has Nx, so a build another checkout made is restored rather than
  repeated.

`generate:modules`, the two Langy generators and the evaluator-catalogue copy
stay uncached: each costs less than an Nx task's own start-up, and
`generate:modules` belongs to no project that could carry the target.

**The trust precondition.** A cached result is only as good as the graph edges
behind it: an import the graph does not know about is an input nobody hashed.
`langwatch/package-boundaries` refuses both ways of making one, at error: a
relative import that escapes its package (`packageEscape`, `unownedEscape`) and
an `@langwatch/*` import its `package.json` does not declare
(`undeclaredDependency`). A cached pass is trusted on that basis and no other.

## Amendment, 2026-09-30: builds go through Nx, Go included

**Every build is a cached Nx `build` target.** The JS builds keep their
package.json scripts; `targetDefaults.build` gives each its real outputs. The
three consoles Go embeds (`haven-web`, `idpsim-web`, `mailsim-web`) write
outside their project, to the `web/dist` their Go package embeds, so each has a
filtered entry naming that directory. `scenario-child` hashes `EMIT_META`,
which adds files to its output. Builds hash `node --version`.

**Go is inferred, not declared.** `dev/nx/go-plugin.mjs` makes the root Go
module project `go` (`test:go`, `lint:go`) and every `cmd/<name>` main package
(plus `infra/clickhouse-serverless/cmd/*`) a project whose `build` is
`go build -o .bin/<name>/<name> ./cmd/<name>`. Its inputs (named input `go`)
are deliberately coarse: every `*.go` file, every `go.mod`/`go.sum`, `go.work`,
and every file under the Go trees (`cmd`, `pkg`, `services`, `tools`,
`infra/clickhouse-serverless`, `sdks/go`), so a `//go:embed` file is always
hashed; plus `go version` and the `GOOS`, `GOARCH`, `CGO_ENABLED`, `GOFLAGS`
and `GOEXPERIMENT` env. A miss costs one incremental `go build`, so breadth is
cheap and a missing input is not. Each binary implicitly depends on `go`,
which owns every Go file no other project owns, so `nx affected` reaches every
binary on any Go change. `haven` and `service` also depend on the consoles
they embed, build them first and hash their output. A new binary that embeds
a console must be added to the plugin's `consoles` map. `@nx-go/nx-go` and
`@naxodev/gonx` model one module per project; this repository is one module
with many mains, so a twenty-line plugin fits better.

`test:go` is not cached. Go's test cache already records every file and
environment variable a test reads, which no Nx input declaration can match,
and several suites read the working tree. `lint:go` is cached (sources,
`.golangci.yml`, and the Makefile that pins the linter).

**Where Go stays on `go`.** A cache hit costs about 1.5 s with the daemon and
4-7 s without; a `go build` no-op costs about 1.4 s and `go run` from Go's
executable cache about 0.4 s (indicative, busy machine). So the hot paths keep
Go's own cache: `devscripts.sh` (`go run`), `make service` (`go run`, which
also avoids concurrent restores overwriting a running binary), and
`make service-watch` (air owns the rebuild loop). `make haven` and
`make haven-web` go through Nx.

**The lockfile no longer busts every cache.** A `nx:run-script` target without
an `externalDependencies` input hashes every external package, and
`sharedGlobals` named `pnpm-lock.yaml` outright, so any lockfile change missed
every task. `dev/nx/npm-deps-plugin.mjs` now gives each workspace member a
`npmDeps` named input: every package it declares, plus the runtime
dependencies of every workspace package it reaches, each named by the exact
node Nx holds for the installed version (bare when hoisted or unique, else
`name@version`; a bare name with several versions makes Nx pick one at random
per run). Nx hashes each with its transitive closure. Every JS target default
takes `npmDeps` plus its root-installed tool (`typescript`, `vitest`,
`oxlint`), and the lockfile is gone from `sharedGlobals`. Nx hashes a pnpm v9
node by name and version, so a republished tarball under the same version is
not seen. `pluginsConfig["@nx/js"]` sets `projectsAffectedByDependencyUpdates`
to `auto` and keeps `analyzeSourceFiles` off, as it was.

## Amendment, 2026-09-30: charts, generators and repo-wide builds

**Helm is inferred.** `dev/nx/helm-plugin.mjs` makes one project per
`charts/*/Chart.yaml`, named `chart-<dir>` (`langwatch` is the SDK's name). Each
has cached `helm:deps` (repositories added, `helm dependency build`, output
`charts/`), `helm:lint` and `helm:template` (`--set autogen.enabled=true`, the
flags the chart workflows use). Inputs are the chart directory without its
built `charts/`, plus `helm version --short`; the umbrella also hashes its three
leaf charts and depends on them. Without helm the targets fail with an install
hint. `helm package`, `push` and the release workflows stay as they are.

**Generators are cached targets.** `generate:langy-skills`,
`generate:feature-map`, `generate:setup-skill-bodies`, `generate:evaluators`
(the langevals copy) and the SDK's `generate` (openapi types, feature map,
evaluators) each declare exact inputs and outputs in `nx.json`.
`start:prepare:files` is `ensure:ai-gateway-secrets` and `generate:modules`
(never cached: secrets, and a Go run that is already fast) followed by one
`nx run-many` over them and `prisma:generate`.

**Repo-wide builds live on `workspace`** (`dev/nx/workspace-plugin.mjs`, since
`go` owns the root): `build:types` is `tsc -b tsconfig.build.json`, its inputs
and outputs read from the solution's references so `sync:references` keeps
them true; it depends on the SDK build because the referenced packages import
its declarations. `lint:rules` (semgrep) and `test:scripts` (bats) run the
Makefile recipes, as `lint:go` does; `herrgen` is a target of `go`. The
Makefile targets of the same names call Nx.

## References

- Related ADRs: [076](./076-single-pnpm-workspace.md) (single pnpm workspace),
  [143](./143-formatting.md)
- Configuration: `nx.json`, `.nxignore`
