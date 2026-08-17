# ADR-099: TypeScript 7, and what the typecheck memory ceiling actually was

**Date:** 2026-08-17

**Status:** Proposed

## Context

Two things arrived together, and they turned out to be the same conversation.

**The compiler.** The repo has typechecked with the native compiler since it was
a preview: `@typescript/native-preview@7.0.0-dev.20260705.1`, invoked as `tsgo`.
TypeScript 7.0.2 is now the `latest` tag on npm, and the preview channel has
stopped moving — its own `latest` is still that July dev build. Meanwhile the
workspace carried three different compilers: `^5.9.x` in most packages, `^6.0.3`
in the app and a few others, and the preview binary on top. The published
compiler is the same program as the preview binary, with months of fixes and a
stable release line behind it.

**The memory.** A typecheck was observed taking 9 GB on an 18 GiB laptop. The
number is exact, not approximate, and that is the tell: `CheckGoMemLimit`
resolves `GOMEMLIMIT` to half the machine, clamped to `[4, 10]` GiB, so an
18 GiB machine gets exactly 9 GiB. `GOMEMLIMIT` is a soft ceiling, not a
reservation — the Go runtime collects lazily and lets the heap expand toward it.
Measured cold on this machine, with the app project:

| `GOMEMLIMIT` | wall  | max RSS | peak footprint |
|--------------|-------|---------|----------------|
| 9 GiB        | 121 s | 2.29 GB | 9.08 GB        |
| 3 GiB        | 207 s | 3.48 GB | 6.13 GB        |

The 9 GB a developer sees in Activity Monitor is `phys_footprint`, and it sits
at the ceiling because that is where the ceiling is. Sampled at four ceilings,
the resident working set never left the 2.3–3.5 GB band while the footprint
tracked whatever it was allowed:

| `GOMEMLIMIT` | max RSS | peak footprint |
|--------------|---------|----------------|
| 9 GiB        | 2.29 GB | 9.08 GB        |
| 6 GiB        | 2.26 GB | 6.57 GB        |
| 5 GiB        | 3.10 GB | 7.77 GB        |
| 3 GiB        | 3.48 GB | 6.13 GB        |

**The wall-clock column is deliberately absent.** These were sampled on a laptop
running four worktree stacks at a load average of 80, and the times that came
back (121 s at 9 GiB, 409 s at 6, 840 s at 5, 207 s at 3) are not monotonic in
anything and are contention, not signal. What survives the noise is the shape:
the footprint follows the ceiling, the working set does not, and the tighter
ceilings spent conspicuously more system than user time — the signature of a
runtime collecting against a limit rather than working.

So the ceiling was too generous, the floor people would reach for is too tight,
and the program itself is fatter than it needs to be: 52 MB of first-party
source reaches the compiler, of which 11 MB is generated Prisma types and 7.7 MB
is a single generated Ajv validator on 19 lines. The validator carries
`@ts-nocheck` and has a sibling `.d.ts`, so it was parsed and bound for no
benefit at all — `allowJs` plus an `./src/**/*` include swept it in as a root
file.

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
TypeScript 6 makes a hard error rather than a warning (`TS5101`), so the SDK
needs `"ignoreDeprecations": "6.0"` in its tsconfig to build at all. That flag
is a transition-release courtesy, and it does not exist in 7. The runway here
is one major, not indefinite. Emitting declarations
with `tsc --emitDeclarationOnly` works, but it emits an unbundled tree that
still references `@langwatch/langy`, a source-only devDependency the published
tarball cannot resolve; making that resolve means changing what the package
declares as a dependency, which is a decision about the published artifact and
not a build detail. These two move when a `.d.ts` bundler that speaks the TS 7
API exists.

**Static scans go through one API session.** TypeScript 7 has no in-process
parser: `ts.createSourceFile(fileName, text)` is gone, and parsing is a request
to the Go binary. `src/test-utils/tsAst.ts` owns a single `API` session for the
process, layers a virtual filesystem over the real one so a scan can parse text
that is not on disk, and hands back a `SourceFile`.

Two constraints in that seam were found by its tests rather than reasoned out,
and both are the kind that would otherwise be discovered as a mysterious CI
timeout. Opening a file makes the compiler search its ancestors for a tsconfig
that claims it, so a synthetic path under `platform/app` is claimed by the
app's config and parsing one snippet loads the entire 52 MB project — past a
test timeout. Every parse therefore happens under a temporary directory with no
tsconfig above it, landing in an inferred project of its own. And the session
caches source files by path, so each parse takes a name no earlier parse used;
without that, a scan pinning a rule across several snippets judged all of them
by the first. The four scans that used the
old API — `mockSpecifierScan`, `teardownScan`, `vitestAliasTable` and the
ClickHouse `replicatedEngineGuard` test — go through it, and take their node
predicates from `typescript/unstable/ast`. The `unstable` name is about API
stability guarantees, not maturity: it is the surface the language server itself
runs on.

**We lower the memory ceiling and stop feeding the compiler dead weight.**
`CheckGoMemLimit` clamps to `[3, 6]` GiB instead of `[4, 10]`, and the generated
Ajv validator is excluded from the app's tsconfig, where it was a seventh of
everything parsed and none of it checked.

## Rationale / Trade-offs

The pinned preview was not broken, so the case for moving is not a bug — it is
that a dev-tagged prerelease had become load-bearing for every typecheck in CI
while its channel went quiet. Tracking the release line is the cheaper position
to hold.

Holding two packages on 6 is the part that grates, since it leaves the repo
spanning two compiler majors. The alternative was to change what the SDK
publishes in the same change that moves a compiler, which mixes a build concern
with a packaging one and would be discovered by consumers rather than by us.
A pinned major in two leaf packages is visible and reversible; a broken `.d.ts`
in a published tarball is neither.

For the memory, the honest statement of the evidence is narrower than the
change, and worth writing down as such. What the samples establish is that the
working set stays in a 2.3–3.5 GB band no matter what ceiling it is given, so a
6 GiB ceiling cannot be the thing constraining it, while a 9 GiB one
demonstrably gets spent. What they do not establish is that 6 is optimal:
**the specific number is a judgement between measured points, not a measured
optimum**, because the machine was too loaded for the timings to mean anything.
It deserves a clean re-measure on a quiet machine, and the direction survives
either way — anything at or below 6 hands out strictly less than 10 did, with a
working set that never came close to needing it.

The floor of 3 is there because a ceiling below the live heap is the worse
failure of the two: the runtime cannot collect its way under it, so it pays the
collection cost continuously and misses the target anyway, which is what the
3 GiB sample's 6.13 GB footprint is.

## Consequences

`pnpm typecheck` runs `tsc`, and the name `tsgo` survives only as a bin shim for
worktrees that still have one. The editor and the CI check now share one
compiler and one implementation, so "it typechecks in my editor but not in CI"
loses its most common cause.

A typecheck should footprint around 6 GB rather than 9 GB on a 16-plus GiB
machine, at no measured cost in wall clock, and the compiler stops parsing
7.7 MB it never checked.

Anything that wants a TypeScript AST now spawns a `tsgo` child through
`tsAst.ts`. That is a real cost the old in-process parser did not have — one
process per scanning node process, so one per vitest worker — and it is the
price of the native compiler having no JS parser to lend.

The sharper consequence is that **parsing is now a round trip, so scans batch or
they do not finish**. Ported one-file-at-a-time, the two tree-wide scans stopped
completing at all: 25 minutes without a single test file finishing, where they
had taken seconds. Parsing every file in one exchange put the same suites at
4.5 s, and a direct benchmark puts the batch 20x ahead per file (0.2 ms against
4.7 ms). So `scanSourceForMockSpecifiers` and `scanTestSourceForUnsafeDeleteMany`
now take a parsed `SourceFile` rather than text: parsing moved out to the caller
precisely so the caller can do all of it at once. Any future scan over many
files must use `parseSourceTexts`, and the per-file `parseSourceText` is for
snippets and one-offs.

The two packages on `typescript@6` are a standing item, not a resting state.

## References

- Related ADRs: [ADR-095](095-haven-tsgo-governor.md) (the governor whose
  `GOMEMLIMIT` policy this amends), [ADR-076](076-single-pnpm-workspace.md)
  (why one root install governs every package's compiler version)
- Specs: `specs/setup/check-slots.feature`,
  `specs/setup/haven-tsgo-governor.feature`
- TypeScript 7.0.2 on npm; the `typescript/unstable/*` export map
