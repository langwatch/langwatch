# ADR-099: TypeScript 7 is the compiler

**Date:** 2026-08-17

**Status:** Proposed

## Context

The repo has typechecked with the native compiler since it was a preview:
`@typescript/native-preview@7.0.0-dev.20260705.1`, invoked as `tsgo`.
TypeScript 7.0.2 is now the `latest` tag on npm, and the preview channel has
stopped moving — its own `latest` is still that July dev build. A dev-tagged
prerelease had quietly become load-bearing for every typecheck in CI.

Meanwhile the workspace carried three different compilers: `^5.9.x` in most
packages, `^6.0.3` in the app and a few others, and the preview binary on top.
The published compiler is the same program as the preview binary, with months of
fixes and a stable release line behind it.

## Decision

**We move to `typescript@7` as the compiler everywhere it only typechecks**, and
drop `@typescript/native-preview`. `tsc` is the native binary now, so the
`typecheck` scripts invoke `tsc` and the separate `typecheck:legacy` lane — the
JS compiler over the editor tsconfig — is deleted, because under 7 there is no
second implementation for it to be a second opinion from. CI never ran it.

**Two packages stay on `typescript@6`: `sdks/typescript` and `mcp/typescript`.**
Both publish bundled `.d.ts` through `tsup`'s `dts: true`, which drives the old
programmatic compiler API. TypeScript 7's root export is `./lib/version.cjs` — a
version constant — so that build breaks outright on 7.

Six is not free either, and the reason is worth recording because it bounds how
long this can be tolerated: tsup's dts worker sets `baseUrl` itself, which
TypeScript 6 makes a hard error rather than a warning (`TS5101`), so both
packages need `"ignoreDeprecations": "6.0"` in their tsconfig to build at all.
That flag is a transition-release courtesy, and it does not exist in 7. The
runway here is one major, not indefinite. Emitting declarations with
`tsc --emitDeclarationOnly` works, but it emits an unbundled tree that still
references `@langwatch/langy`, a source-only devDependency the published tarball
cannot resolve; making that resolve means changing what the package declares as
a dependency, which is a decision about the published artifact and not a build
detail. These two move when a `.d.ts` bundler that speaks the TS 7 API exists.

**Static scans go through one API session.** TypeScript 7 has no in-process
parser: `ts.createSourceFile(fileName, text)` is gone, and parsing is a request
to the Go binary. `src/test-utils/tsAst.ts` owns a single `API` session for the
process, layers a virtual filesystem over the real one so a scan can parse text
that is not on disk, and hands back a `SourceFile`. The four scans that used the
old API — `mockSpecifierScan`, `teardownScan`, `vitestAliasTable` and the
ClickHouse `replicatedEngineGuard` test — go through it, and take their node
predicates from `typescript/unstable/ast`. The `unstable` name is about API
stability guarantees, not maturity: it is the surface the language server itself
runs on.

**A generated Ajv validator leaves the app's program.** 52 MB of first-party
source reaches the compiler, and 7.7 MB of it — a seventh of everything parsed —
is one generated validator on 19 lines, swept in as a root file by `allowJs`
plus an `./src/**/*` include. It carries `@ts-nocheck` and has a sibling `.d.ts`
that the import resolves to either way, so it was parsed and bound for no
benefit at all. Excluded from `tsconfig.tsgo.json`.

Two constraints in that seam were found by its tests rather than reasoned out,
and both are the kind that would otherwise be discovered as a mysterious CI
timeout. Opening a file makes the compiler search its ancestors for a tsconfig
that claims it, so a synthetic path under `platform/app` is claimed by the app's
config and parsing one snippet loads the entire 52 MB project — past a test
timeout. Every parse therefore happens under a temporary directory with no
tsconfig above it, landing in an inferred project of its own. And the session
caches source files by path, so each parse takes a name no earlier parse used;
without that, a scan pinning a rule across several snippets judged all of them
by the first.

## Rationale / Trade-offs

The pinned preview was not broken, so the case for moving is not a bug — it is
that a dev-tagged prerelease had become load-bearing for every typecheck in CI
while its channel went quiet. Tracking the release line is the cheaper position
to hold.

Holding two packages on 6 is the part that grates, since it leaves the repo
spanning two compiler majors. The alternative was to change what the SDK
publishes in the same change that moves a compiler, which mixes a build concern
with a packaging one and would be discovered by consumers rather than by us. A
pinned major in two leaf packages is visible and reversible; a broken `.d.ts` in
a published tarball is neither.

Dropping the validator is the cheapest call in this ADR and is recorded only
because it is invisible otherwise: the exclusion is one line of tsconfig, and
the file it drops is the single largest thing the compiler was reading.

A Go tool was the obvious alternative to the parse seam, and it is closed rather
than unexplored: `github.com/microsoft/typescript-go` is a real go-gettable
module, but `ast`, `parser`, `checker` and `ls` are all under `internal/`, which
Go forbids other modules from importing. Microsoft ships the compiler as a
binary and a protocol, not as a Go library. Reimplementing the msgpack API
protocol, or reaching for a non-TypeScript parser, are the remaining options;
neither is justified while the seam performs.

## Consequences

`pnpm typecheck` runs `tsc`, and the name `tsgo` survives only as a bin shim for
worktrees that still have one. The editor and the CI check now share one
compiler and one implementation, so "it typechecks in my editor but not in CI"
loses its most common cause.

Anything that wants a TypeScript AST now spawns a `tsgo` child through
`tsAst.ts`. That is a real cost the old in-process parser did not have — one
process per scanning node process, so one per vitest worker — and it is the
price of the native compiler having no JS parser to lend.

The sharper consequence is that **parsing is now a round trip, so scans batch or
they do not finish**. Ported one-file-at-a-time, the two tree-wide scans stopped
completing at all: 25 minutes without a single test file finishing, where they
had taken seconds. Parsing every file in one exchange put the same suites at
seconds again, and a direct benchmark puts the batch 20x ahead per file
(0.2 ms against 4.7 ms). So `scanSourceForMockSpecifiers` and
`scanTestSourceForUnsafeDeleteMany` now take a parsed `SourceFile` rather than
text: parsing moved out to the caller precisely so the caller can do all of it
at once. Any future scan over many files must use `parseSourceTexts`, and the
per-file `parseSourceText` is for snippets and one-offs.

Even batched, the walk over every tracked test file costs appreciably more than
in-process parsing did — around 15s, past vitest's 10s default for a hook — so
that hook declares its own timeout and says why.

The compiler stops parsing 7.7 MB it never checked. The remaining bulk is
generated Prisma types, at 10.5 MB across 111 files, and the reason to write
that down is to stop it being mistaken for the next thing to fix.

It is not a large schema, and both obvious levers are already closed. 103 models
is ordinary; the amplification is Prisma's constant, flat across the tree at a
67 KB median per model — a leaf model with six scalar columns and no relations
still generates 44 KB and 52 exported types, which is the floor before our
schema enters into it. The hub models add a multiplicative term, since Prisma
emits a nested `Create`/`Update`/`Upsert` family once per relation and everything
project-scoped points back at `Project` (756 KB, 456 types, 299 of them those
families) — but that fan-in is the multi-tenancy model, not an accident. And
excluding the directory from `include` would change nothing: all 111 files
already carry `@ts-nocheck`, `models.ts` re-exports all 103 models, so the tree
is reachable through any import of the client regardless.

**Bytes are also the wrong unit.** Bytes are what gets parsed, which is cheap and
linear; what costs is type instantiations, and the two come apart — Prisma 7
briefly tripled instantiations across every schema (11.4M to 30.2M) by defaulting
one generic to `undefined` and defeating the instantiation cache, without adding
a byte of output (prisma/prisma#29011, fixed in 7.9.0; we are on 7.9.1 and the
generated client carries the fix). So the next step here is a measurement rather
than a change — `--extendedDiagnostics`, or `--generateTrace` for per-file
attribution — and nothing so far establishes that this is the binding
constraint. The sampling in [ADR-100](100-the-typecheck-memory-ceiling.md) is
mild evidence against: the working set stayed in a 2.3–3.5 GB band at every
ceiling, so the compiler never came close to needing what it had.

The two packages on `typescript@6` are a standing item, not a resting state.

## References

- Related ADRs: [ADR-100](100-the-typecheck-memory-ceiling.md) (the memory
  ceiling the same investigation turned up), [ADR-076](076-single-pnpm-workspace.md)
  (why one root install governs every package's compiler version),
  [ADR-085](085-governed-chart-runtime-without-eval.md) (which generated the
  validator, and whose "`checkJs` parses it without checking it" consequence
  this supersedes — it is not parsed at all now)
- Specs: `specs/setup/typescript-7.feature`
- TypeScript 7.0.2 on npm; the `typescript/unstable/*` export map
