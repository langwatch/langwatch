# TypeScript

Run `pnpm typecheck` for API, worker, and UI, or select applications with
`pnpm typecheck worker ui`, `pnpm typecheck worker`, or `pnpm typecheck ui`.
Selected applications run sequentially with their own compiler settings and
incremental caches. Optional Haven hooks queue agent commands before they start;
the package scripts and compiler launchers run directly.
Each check includes that application's tests. Compiler
flags can follow the names, for example `pnpm typecheck worker --extendedDiagnostics`.
Use `pnpm typecheck:one <package-name-or-directory>` for another workspace
package, or `pnpm typecheck:all` for the full workspace.
`typecheck:one` delegates to the package's own script, including declaration
preparation; package names use pnpm's native filter.

`pnpm install` removes the old automatic compiler and linter shims without
replacing fresh pnpm launchers. Existing checkouts can run
`node dev/scripts/install-check-shims.mjs --remove` immediately.

For local iteration, use `pnpm typecheck:fast`, or select applications with
`pnpm typecheck:fast worker ui`. This checks production entrypoints through
the existing application configs and keeps their incremental caches separate
from the full checks. Test directories, mocks, and colocated `.test.*` and
`.spec.*` files are excluded as entrypoints. Imports are still followed, so
a production import of a test file brings that file into the check.
Run `pnpm typecheck` before submitting a change; it includes the tests.

Each application prepares declarations from its `tsconfig.declarations.json`
solution before checking its own source. The preparation command accepts the
standard `--project` option. Without it, `pnpm typecheck:declarations` uses
`dev/tsconfig.declarations.json`, the complete adoption list.
Application and adopted package compilers resolve the plain `types` export to
local declarations. Runtime loaders and tools continue to use the `default`
source export. The cyclic web group additionally uses the top-level
`langwatch-declaration-source` condition while compiling its members, so those
members resolve their current source rather than a previous distributed output.
Private package imports use the corresponding declaration and source paths, so
an emitted `#` import does not pull implementation source back into a consumer.
A failed declaration build stops the application check.

Adopted package checks consume dependency declarations through their normal
`tsconfig.json`, with the producer's main references plus references for test
dependencies. Producer projects (or the composite web group) are also prepared
before the package's own no-emit check, so current source is checked and stale
own declarations cannot hide errors; tests may consume those freshly built
declarations. Producers use `rootDir: "src"` and emit flat `dist/*.d.ts` paths.
Package `typecheck` scripts prepare dependencies before running plain
`tsc --noEmit`; existing test roots remain included.
A raw compiler invocation does not prepare declaration artifacts. The package
command is authoritative after a fresh checkout or a dependency change.

The coupled web packages share `dev/tsconfig.web-declarations.json`: TypeScript
project references cannot form cycles. Their package build configs reference
that group, which checks all member sources together with their existing strict
options. A separate source condition keeps group members on source during the
build while other packages resolve to declarations. The declaration runner
distributes successful output from `dev/.cache/web-declarations` into each
member's `dist`, rewriting declaration maps to the local source paths.
Member typecheck scripts prepare their build solution before their no-emit
configs reference the group. This checks current production source first, then
lets tests consume freshly emitted declarations.
Use `pnpm typecheck:declarations` for this step; calling `tsc -b` directly does
not distribute group output. Declaration watch mode is not supported for groups.

Architecture lint's `declaration-project-references` rule checks the producer
graph, including grouped packages. Production workspace dependencies must be
reachable from the producer, even when the normal no-emit config already
references them. Missing or cyclic references fail lint before preparation;
generated output is not required to run this check.

Standalone adopted packages keep declarations and incremental state in their
own `dist/` directory. The cyclic web group keeps one build-info file beside
its staging output under `dev/.cache`; its declarations and maps are distributed
to each member's local `dist/` only after the complete group succeeds. All of
these paths are Git-ignored, outside `node_modules`, and isolated per worktree;
declaration maps lead back to that worktree's source. Normal builds refresh
changed inputs. Use `pnpm typecheck:declarations --clean` to remove these
compiler-owned artifacts, or `--force` to rebuild every adopted project. Do not
share mutable output directories or `.tsbuildinfo` between worktrees.
Unchanged outputs can be restored from the shared immutable
[declaration cache](declaration-cache.md); cache hits still use local `dist/`
and never share build-info files. The pnpm dependency store can remain shared.
The web group keeps its one build-info file beside its staging output, local
to the worktree. Its complete staging output has one cache key; a hit restores
and distributes the group before any dependent package is checked.

The worker's typecheck uses one compiler checker to reduce duplicated type
instantiations. This trades checker parallelism for lower memory use; it does
not impose a hard memory cap. Measure a cold check with
`pnpm typecheck worker --incremental false --extendedDiagnostics`.

Incremental checking is already enabled in `tsconfig.base.json`. It reuses work
between runs; measure cold and warm checks separately. Packages outside the
declaration solution still resolve to source. Adding a
package requires a passing declaration build and consumer check; setting
`composite` alone does not establish that boundary. See
[TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references).

Capture a cold worker trace with
`pnpm typecheck worker --incremental false --generateTrace /tmp/langwatch-worker-trace`.
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
