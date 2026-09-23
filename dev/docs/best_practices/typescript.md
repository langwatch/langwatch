# TypeScript

`pnpm typecheck` is `tsc -b` against the root `tsconfig.json`, a
solution whose `references` name every workspace member's check root and
nothing else, preceded by the api and ui closures as their own `tsc -b`
processes. Three processes rather than one is for memory: `tsc -b` keeps every
file it parses until it exits, so each process frees its cache before the next
starts, and all three run under `GOMEMLIMIT=2GiB` with one checker per
project — 3.1 GB peak instead of 5.9 at the same wall time (ADR-100's
2026-09-23 amendment). Later runs find shared projects up to date, so each
project is still checked once. The recursive form it replaced (`pnpm -r typecheck`, one
`tsc -b` per package, serialised) made a package near the root of the graph
have its up-to-date check re-run by most of the other 194, and reported
`TS6305` errors that were only an artefact of checking a package before a
sibling's declarations existed.

A package's own check root is its `tsconfig.json`, or the
`tsconfig.test.json` that widens it — same sources, `exclude: []`, test types
added. So `pnpm typecheck` does check test files.
Use `pnpm --filter <package> typecheck` for one workspace package alone; there
is no `typecheck:one` any more, and no per-application selection syntax on the
root `typecheck` script either: name the package with pnpm's own filter.

A failing project writes no `.tsbuildinfo`, so it — and everything downstream
of it — is re-checked in full on the next run. On a green tree the warm run is
seconds; a tree carrying errors pays for them on every run, which is why
"leave the error for later" is more expensive here than it looks.

Install admission hooks per worktree with
`haven setup gate-hook codex-gate-hook` for Claude and Codex respectively.
Codex project hooks require a trusted project and review through `/hooks`.
`pnpm install` removes old automatic compiler/linter shims without replacing
fresh pnpm launchers. Existing checkouts can run
`node dev/scripts/install-check-shims.mjs --remove` immediately.
Use `haven slot run -- pnpm typecheck` for explicit terminal queueing.

For local iteration, check the one package you touched:
`pnpm --filter <package> typecheck`. `tsc -b` is incremental through its own
`.tsbuildinfo`, so a repeat run only rechecks what changed underneath it.
Run `pnpm typecheck` before submitting a change; it is the whole workspace,
minutes rather than seconds, and it includes every package's tests.

Applications have no separate declarations project any more.
`apps/api/tsconfig.declarations.json`, `apps/ui/tsconfig.declarations.json` and
`apps/worker/tsconfig.declarations.json` are gone. `tsc -b tsconfig.test.json`
builds an application directly: it walks that project's `references` in
dependency order, building each referenced workspace dependency's own
`tsconfig.build.json` first, then checks the application's own source and
tests in one incremental run. A failed dependency build stops the check.

Most workspace packages follow that same plain path: their `typecheck` script
is `tsc -b`, with no separate declarations project of their own. Two
exceptions still keep one. `packages/mail`'s build config emits JavaScript
rather than declarations (`declaration: false`, since it also has to emit its
`.tsx` email templates as runnable code), so `packages/mail/tsconfig.declarations.json`
is what consumers reference instead of its build config. And the packages that
would otherwise form a reference cycle, which TypeScript project references
cannot do, are folded into one shared composite project instead,
`dev/tsconfig.web-declarations.json`, built and checked together as the
"coupled web group." Application and adopted-package compilers resolve the
plain `types` export to a package's built declarations; runtime loaders and
tools continue to use the `default` source export. The cyclic web group and
`packages/mail` additionally use the top-level `langwatch-declaration-source`
condition while compiling their own members, so those members resolve to
current source rather than a previous build's output. Private package imports
use the corresponding declaration and source paths, so an emitted `#` import
does not pull implementation source back into a consumer.

Package `typecheck` scripts are `tsc -b`, so preparing dependencies and
checking the package's own source is one command and one incremental build,
not a wrapper around a second one; existing test roots remain included
wherever the script names a test config. Producers use `rootDir: "src"` and
emit `dist/*.d.ts`. Calling `tsc -b` directly, whether from the package
directory or by naming its project file, is exactly the package command, not
a bypass of it.

Both of those exceptions are on their way out, and so is the machinery around
them: internal packages are moving to source-first manifests, after which no
internal package emits declarations for another to read, the 190
`tsconfig.build.json` files and the `langwatch-declaration-source` condition
go, and each real artifact builds flat from source with no dependency-ordered
chain in front of it. The plan, its waves and the measurements behind them are
`dev/docs/plans/typescript-tidy-projects.md`. What follows describes the tree
as it is today.

The coupled web group's members share `dev/tsconfig.web-declarations.json`
because TypeScript project references cannot form cycles, so the group is
built and checked together as one composite project instead of as separate
producers. Their own package build configs reference that group directly. A
separate source condition keeps group members on source during the build
while other packages resolve to declarations. Member `typecheck` scripts are
`tsc -b`, the same as any other package's: it walks straight to the group's
project reference and builds it in place, incrementally, through the group's
own build-info file.

Architecture lint's `declaration-project-references` rule checks the producer
graph, including grouped packages. Production workspace dependencies must be
reachable from the producer, even when the normal no-emit config already
references them. Missing or cyclic references fail lint before preparation;
generated output is not required to run this check.

Nobody types a project reference. `pnpm sync:references` derives every
`references` array from the workspace manifests and rewrites it in place;
`node packages/architecture-enforcer/src/tools/sync-tsconfig-references.mjs --check` prints the files that
would change and exits non-zero, and the same rule reports drift as a lint
violation naming the missing or extra entry. The rules: a package's producer is
its own `tsconfig.build.json`, or the group solution when it belongs to the
cyclic web group; `tsconfig.build.json` references one producer per workspace
`dependencies` entry, sorted by dependency name; `tsconfig.json` references its
own producer first, then those, then the `devDependencies` producers; and
`tsconfig.declarations.json` references both dependency kinds. Three
consequences of those rules are worth naming: a build config that emits
JavaScript rather than declarations (`declaration: false`, as `@langwatch/mail`
does for its `.tsx` templates) is not the producer and is not part of the
graph, so the package's `tsconfig.declarations.json` is what consumers
reference; an application, which has no build config of its own, carries its
references directly in `tsconfig.json` and `tsconfig.test.json` rather than in
a separate declarations project; and because references may not form a cycle
while package dependencies may, one edge of each cycle is dropped, the first
whose removal leaves the whole graph acyclic. An entry the rules cannot derive
is kept only when the same file records it under `langwatchExtraReferences`,
so a hand exception states itself. Adding a dependency and running the command
is the whole ceremony.

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
(`pnpm sync:references`), because it must agree with `package.json` exactly or
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
(`"dep": "catalog:<name>"`), named for the reason rather than the package. A
dependency whose manifests still disagree for no documented reason is left
with its own explicit range everywhere, on purpose: `dev/scripts/print-resolved-versions.mjs`
is what proved the migration didn't silently change any manifest's resolved
version, and `packages/architecture-enforcer/tests/catalog-enforcement.test.ts`
is what stops a manifest drifting back to an explicit range for a dependency
the default catalog already carries. New manifests declare `"dep": "catalog:"`
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
