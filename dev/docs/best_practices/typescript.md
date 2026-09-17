# TypeScript

`pnpm typecheck` checks every workspace package: `pnpm --workspace-concurrency=1
-r --no-bail --filter "!@langwatch/server" typecheck` runs each package's own
`typecheck` script, in dependency order, and keeps going past a package that
fails so the rest still report. That per-package script is `tsc -b` for most
packages, or `tsc -b tsconfig.test.json` for the three applications and a few
packages whose test config is a superset of the source config, or
`tsc -b tsconfig.json tsconfig.tests.json` (or `tsconfig.type-tests.json`)
where a package keeps its test config separate. Each check includes that
package's tests wherever its own script names a test config.
Use `pnpm --filter <package> typecheck` for one workspace package alone; there
is no `typecheck:one` any more, and no per-application selection syntax on the
root `typecheck` script either: name the package with pnpm's own filter.

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
`node dev/scripts/sync-tsconfig-references.mjs --check` prints the files that
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

pnpm catalogs are the analogous single source for a dependency's *version*,
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
