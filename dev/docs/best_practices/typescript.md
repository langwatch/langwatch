# TypeScript

`pnpm typecheck` is one `tsc -b --builders 1` under `GOMEMLIMIT=2GiB` against the root `tsconfig.json`, a
solution whose `references` name every workspace member's container `tsconfig.json`
and nothing else. Each project is checked once, with one checker
(`tsconfig.base.json`); ADR-100 has the memory measurements. The recursive form it replaced (`pnpm -r typecheck`, one
`tsc -b` per package, serialised) made a package near the root of the graph
have its up-to-date check re-run by most of the other 194, and reported
`TS6305` errors that were only an artefact of checking a package before a
sibling's declarations existed.

Many agent sessions share one machine, so parallelism multiplies: every
heavy command stays at one builder and one checker. `pnpm build:types` runs
`GOMEMLIMIT=2GiB tsc -b --builders 1` like `typecheck` (it was 16 builders),
`pnpm-workspace.yaml` caps recursive `pnpm -r`/`--filter` runs with
`workspaceConcurrency: 2`, and Nx runs at most two tasks at once
(`parallel` in `nx.json`, `--parallel=2` on the test scripts).

A package's `tsconfig.json` is a solution container: it compiles nothing, keeps the
compiler options its other configs extend, and references them. A package that
publishes declarations has `tsconfig.build.json` (emits `dist/*.d.ts`) and
`tsconfig.test.json` (its sources and tests, checked against that build); one that
does not has `tsconfig.app.json` alone. So `pnpm typecheck` does check test files.
Use `pnpm --filter <package> typecheck` for one workspace package alone; there
is no `typecheck:one` any more, and no per-application selection syntax on the
root `typecheck` script either: name the package with pnpm's own filter.

A failing project writes no `.tsbuildinfo`, so it — and everything downstream
of it — is re-checked in full on the next run. On a green tree the warm run is
seconds; a tree carrying errors pays for them on every run, which is why
"leave the error for later" is more expensive here than it looks.

Install admission hooks per worktree with
`haven self setup gate-hook codex-gate-hook` for Claude and Codex respectively.
Codex project hooks require a trusted project and review through `/hooks`.
Use `haven machine slot run -- pnpm typecheck` for explicit terminal queueing.

For local iteration, check the one package you touched:
`pnpm --filter <package> typecheck`. `tsc -b` is incremental through its own
`.tsbuildinfo`, so a repeat run only rechecks what changed underneath it.
Run `pnpm typecheck` before submitting a change; it is the whole workspace,
minutes rather than seconds, and it includes every package's tests.

Applications have no declarations project. An application's `tsc -b` builds its
container, whose `tsconfig.app.json` walks its `references` in dependency order,
building each workspace dependency's `tsconfig.build.json` first, then checks the
application's own source and tests in one incremental run. A failed dependency
build stops the check.

`tsconfig.build.json` is the declaration producer everywhere. Where a package's
build emits JavaScript instead, that config is `tsconfig.js.json` and stays out of
the reference graph: `packages/mail` (`declaration: false`, since its `.tsx` email
templates must run) and `services/langyworker`. Application and adopted-package
compilers resolve the plain `types` export to a package's built declarations;
runtime loaders and tools continue to use the `default` source export. The browser
packages' manifests keep the `langwatch-declaration-source` condition as a source
locator for the module generator and the design-system export checks; no tsconfig
reads it. Private package imports use the corresponding declaration and source
paths, so an emitted `#` import does not pull implementation source back into a
consumer.

Package `typecheck` scripts are `tsc -b`, so preparing dependencies and
checking the package's own source is one command and one incremental build,
not a wrapper around a second one; existing test roots remain included
wherever the script names a test config. Producers use `rootDir: "src"` and
emit `dist/*.d.ts`. Calling `tsc -b` directly, whether from the package
directory or by naming its project file, is exactly the package command, not
a bypass of it.

Internal packages are moving to source-first manifests, after which no
internal package emits declarations for another to read, the 190
`tsconfig.build.json` files and the `langwatch-declaration-source` condition
go, and each real artifact builds flat from source with no dependency-ordered
chain in front of it. The plan, its waves and the measurements behind them are
`dev/docs/plans/typescript-tidy-projects.md`. What follows describes the tree
as it is today.

Nobody types a reference between packages. `pnpm sync:references` runs `nx sync`,
whose `@nx/js:typescript-sync` generator writes them from the Nx project graph
(every `dependencies`, `devDependencies`, `peerDependencies` and
`optionalDependencies` entry): each `tsconfig.build.json` and `tsconfig.app.json`
references its dependencies' `tsconfig.build.json` (a dependency with no build
config, such as the `langwatch` SDK, by its directory), and the root `tsconfig.json`
references every container. `pnpm typecheck` syncs first; CI runs `nx sync:check`,
which fails on a missing, stale or duplicate reference. References inside a
package (the container's, `tsconfig.test.json`'s `./tsconfig.build.json`, mail's
`./preview/tsconfig.json`) are hand-written, and Nx keeps them. A dependency edge
whose reference would be wrong is opted out in the dependent's own config with
`nx.sync.ignoredDependencies` (`modules/langy/browser` ignores `@langwatch/skills`,
whose files it reads but whose sources it must not see as an unbuilt project's).
TypeScript refuses a cyclic reference graph (TS6202) and §17 refuses every peer
cycle, so nothing drops an edge. The generator needs TypeScript 6's compiler API:
pnpm `packageExtensions` gives `@nx/js` its own `typescript@6.0.3`, and the root
`tsc` stays 7. ADR-150's 2026-10-10 amendment records the change.

## What a package tsconfig states

Everything shared lives in `tsconfig.base.json`: `target`, `module`,
`moduleResolution`, `strict`, `skipLibCheck`, `incremental`,
`forceConsistentCasingInFileNames`, `noEmit`, and the two import-extension
options. A package config restates none of them. When you find yourself
copying a line out of a sibling package, check the base first — roughly 530
lines of the tree's current tsconfigs are options the base already states, or
states the minority value of.

What is genuinely local, and all a package config should carry:

- `include` (and `exclude`, where tests split out),
- `tsBuildInfoFile` — never shared between two projects, always beside what
  the project produces (`dist/tsconfig.<stem>.tsbuildinfo`), never under
  `node_modules`,
- `jsx` and `lib`, for browser code only,
- `types`, where a package needs framework globals its source must not have.

Anything else a config states owes the reader a `//` line saying why. Note
that stating `lib` opts the package out of the `target`-derived default, so a
`lib` left behind a bumped `target` silently loses methods the rest of the
tree has — that is a real bug in the tree today, not a hypothetical.

Configs are static and hand-written. They are short because the base is good,
not because a script writes them; only the `references` array is derived
(`pnpm sync:references`, which is `nx sync`), because it must agree with `package.json` exactly or
the compiler reports `TS6305` instead of an honest error.

Three modern flags were measured against this tree and rejected, so nobody
re-litigates them: `erasableSyntaxOnly` (it bans parameter properties, which
~1,848 files use — the service/repository/adapter idiom), `isolatedDeclarations`
(1,855 errors in one contract package alone, almost all "cannot infer the type
of this Zod expression"), and `moduleResolution: nodenext` for node-executed
packages (it would demand the `.js`-specifier scheme this repo deliberately
abandoned). The evidence is in
`dev/docs/plans/typescript-tidy-projects.md` §10.

pnpm catalogs are the analogous single source for a dependency's _version_,
not its project references. `pnpm-workspace.yaml`'s `catalog:` block holds the
version for every shared dependency whose declared range already agreed
everywhere it was used, or whose differing spellings already resolved to one
version; a manifest opts in with `"dep": "catalog:"` instead of writing the
range itself. A dependency with a second, deliberate resolution — the
published SDK and the MCP server pinning an older TypeScript major so they
don't force it on their consumers, for example — gets a small named catalog
(`"dep": "catalog:<name>"`), named for the reason rather than the package. The
`dependency-catalog` policy (`pnpm lint:architecture`) refuses an explicit range
for a catalogued dependency and an uncatalogued dependency two members share; it
has no exception list. New manifests declare `"dep": "catalog:"`
for anything already in the catalog; `catalogMode: strict` makes `pnpm add`
enforce the same rule for a new dependency.

Standalone adopted packages keep declarations and incremental state in their
own `dist/` directory. The cyclic web group keeps one build-info file beside
its staging output under `dev/.cache`. All of these paths are Git-ignored,
outside `node_modules`, and isolated per worktree; declaration maps lead back
to that worktree's source. `tsc -b` refreshes only the changed inputs on a
normal run; `tsc -b --clean` removes a project's own compiler-owned artifacts,
and `tsc -b --force` rebuilds it regardless of what changed. Do not share
mutable output directories or `.tsbuildinfo` between worktrees; the pnpm
dependency store can remain shared. There is no longer a second, shared cache
sitting behind `.tsbuildinfo`, so a fresh worktree pays one cold build for
everything it touches. Inside that worktree, `.tsbuildinfo` is still what
makes every run after the first one incremental.

The worker's typecheck uses one compiler checker to reduce duplicated type
instantiations. This trades checker parallelism for lower memory use; it does
not impose a hard memory cap. Measure a cold check with
`pnpm --filter @langwatch/worker typecheck --incremental false --extendedDiagnostics`.

Incremental checking is already enabled in `tsconfig.base.json`. It reuses work
between runs; measure cold and warm checks separately. Packages outside the
declaration solution still resolve to source. Adding a
package requires a passing declaration build and consumer check; setting
`composite` alone does not establish that boundary. See
[TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references).

For large Zod schemas, prefer object-shape spreads over long `.extend()` chains
when their parsing semantics match. Preserve unknown-key handling, catchalls,
refinements, defaults, and distinct input/output types. Zod documents the
[typechecking cost of chained extensions](https://zod.dev/api#extend).
The `langwatch/zod-object-composition` rule reports `.extend()` and `.merge()`
on statically resolved Zod objects, including local aliases and workspace
imports. Use `.safeExtend()` when refinements or assignability checks must be
retained. The rule offers no automatic fix because object strictness and
catchalls must be preserved. Opaque factories are outside its static analysis.
Compiling a runtime validator does not simplify its inferred TypeScript types.
Declaration emission can avoid rechecking schema construction in consumers,
but emitted declarations may still expose large Zod generics; benchmark the
consumer as well as the declaration build before adopting this boundary.

Capture a cold worker trace with
`pnpm --filter @langwatch/worker typecheck --incremental false --generateTrace /tmp/langwatch-worker-trace`.
Add `--pprofDir /tmp/langwatch-worker-profile` for the native compiler's CPU and
memory profiles. Tracing adds overhead, so use an untraced run for memory
comparisons. Inspect nested trace events without summing their overlapping
durations, and distinguish compiler work from garbage collection and machine
memory pressure. See Microsoft's
[performance tracing guide](https://github.com/microsoft/TypeScript/wiki/Performance-Tracing).

- **Exhaustive switches**: Always include `never` check in default case
- **Zod for shared types**: Define once, `infer` the TS type
- **Single export per file**: Thin files, single responsibility
- **Colocate interfaces**: Only extract to `types.ts` when shared across files
- **Service wrappers**: Use `get` keyword for repository passthrough, not `bind`
- **Named parameters over positional**: For functions with 2+ parameters, prefer object destructuring. Makes call sites self-documenting and parameter order irrelevant.

  ```typescript
  // Bad: positional parameters
  runScenario(scenarioId, target, setId);

  // Good: named parameters via object destructuring
  runScenario({ scenarioId, target, setId });
  ```
