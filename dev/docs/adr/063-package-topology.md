# ADR-063: Package topology for the server codebase

**Date:** 2026-07-22

**Status:** Proposed

**Related:** ADR-061, ADR-062 (both land inside `src/server` and move with it),
PR #6018 (the closed first attempt — its head ref is the starting point here).

## Context

`langwatch/src/server` is one program. Services, repositories, event-sourcing,
domain types and HTTP routes share a directory tree, a tsconfig and an import
graph with no enforced direction. The ask is to split it into `@langwatch/*`
packages under `/packages`, and to do the cleanups that a move makes cheap —
consistent logging, typed `HandledError` at every boundary, routes separated
from the services they call.

Four measurements decide the shape of that work. They are not estimates.

**A first attempt already exists and was closed.** PR #6018 consolidated
`/packages`, built the composite project graph, and extracted
`@langwatch/contracts` — 526 files, ~460 import sites rewritten. Its branch was
deleted but `refs/pull/6018/head` survives and still carries
`packages/{api,automations,contracts,observability,ssrf}`. That work is
recoverable and was CI-exercised. Redoing it would be waste.

**`app-layer` and `event-sourcing` are one cycle, not two packages.** 176 of
`app-layer`'s 607 files import `event-sourcing`; 129 of `event-sourcing`'s 603
import `app-layer`. A package boundary is a directed edge. It cannot be drawn
through a cycle, so no amount of file-moving packages these two — the cycle has
to be broken first, and breaking it is the actual work.

**`AppRouter` cannot cross a `.d.ts` boundary.** ~80 routers and ~516
procedures merge into a type that exceeds tsgo's serialization limit (TS7056).
Packages emit declarations; any package whose public surface transitively
reaches `AppRouter` therefore fails to emit. This blocks the client/server
split outright, and it is independent of where files live.

**Prisma's cost is irreducible and is not a reason to do anything.** Measured
2026-07-21: the schema's 92 models form a fully-connected relation graph, so
importing one model type loads ~210k lines either way. The split-output
generator does not help. Do not fold a Prisma upgrade into this.

## Decision

Split by dependency direction, in sequence, with the blocking work first.

### Naming: flat scope, enforced by a rule rather than a prefix

Keep `@langwatch/<name>`. No layer prefix.

A prefix (`@langwatch/svc-*`, `@langwatch/domain-*`) communicates intent to a
reader but enforces nothing, and adopting one now renames the eight packages
that already exist for no functional gain. What needs to hold is the *edge
direction*, and that is enforceable directly — a dependency-cruiser rule in CI
that fails the build on a disallowed import is worth more than a naming
convention, and it survives every future rename.

Layers, innermost first. Each may depend only on layers above it:

| Layer | Packages | May depend on |
|---|---|---|
| Contracts | `contracts`, `handled-error` | nothing in-repo |
| Domain | `domain`, `event-sourcing` | contracts |
| Data | `<domain>-repositories` | domain, contracts |
| Service | `<domain>` | data, domain, contracts |
| Transport | `api`, the Next.js app | services |

### Phase 0 — recover PR #6018

Restore `refs/pull/6018/head` onto a fresh branch, rebase onto main, re-verify.
Nothing new is designed here; this is recovering measured work that was closed
rather than reverted. It also re-establishes the composite graph every later
phase needs.

Two lessons from that attempt are load-bearing and must survive the rebase:
check the app with `tsgo --noEmit -p`, never `--build` (the latter mis-resolves
`vite/client` ambients at full-program scale), and keep the vite/vitest config
files inside the app project for the same reason.

### Phase 1 — shrink `AppRouter` until declarations emit

Give the fat tRPC procedures explicit `.output()` schemas so the merged router
type stops being an inference pile. `langwatch/tsconfig.emit-probe.json`
measures the gap; the target is zero TS7056.

This is first because it is the only hard blocker, it is on the critical path
for every package that touches the router, and it needs no file moves — so it
can proceed while the tree is otherwise stable. It is also independently
valuable: explicit output schemas are what stop a router leaking internal
shapes, which is the same discipline ADR-057's share DTO applies.

**Measured 2026-07-22** (probe run on the Phase 0 branch). Two numbers frame
the work. The router surface is 77 files and 469 procedures, and `.output()`
appears **zero** times across all of them — every return type is inferred.
But the emit failures are not spread across those 469: there are **five**
TS7056 sites, and four of them inherit from the first.

| site | what it is |
|---|---|
| `src/server/api/root.ts:176` | `appRouter` — the root cause |
| `src/utils/api.tsx:329`, `:337` | the two client-side mirrors |
| `src/hooks/useSSESubscription.ts:24` | generic hook over the router |
| `src/components/experiments/BatchEvaluationV2/BatchEvaluationV2EvaluationResults.tsx:26` | a hook inferring off `api.*` |

Plus five TS2883 "cannot be named without a reference to…" sites, which need an
explicit annotation rather than any restructuring. **Two are fixed** —
`modelProviders/utils.ts:29` and `scenarios/execution/model.factory.ts:18`,
both of which failed on `LanguageModelV3` from the transitively-installed
`@ai-sdk/provider`. Adding it as a direct dependency and annotating with the
provider *interface* clears them (probe: TS2883 5 → 3).

That annotation has a trap worth naming, because #6018 hit it and reverted
(`c626e8cd0`): the obvious type to reach for is `LanguageModel` from `ai`, but
that is `GlobalProviderModelId | LanguageModelV3 | LanguageModelV2` — a union
whose string branch has no `.modelId`, so every caller reading one breaks.
`LanguageModelV3` carries `modelId` and is transparent to callers. Only a
whole-program typecheck catches the difference; per-file checks do not.

The three remaining TS2883 (`BatchEvaluationV2EvaluationResults.tsx:26`,
`spanTreePagedQuery.ts:41`, `utils/api.tsx:329`) are all in the router/client
cluster and two of them also carry TS7056, so they are expected to move with
the `appRouter` work rather than before it.

So Phase 1 is not "annotate 469 procedures". It is: shrink `appRouter` enough to
serialize, then re-measure — the other four TS7056 sites are expected to fall
with it. Annotate the procedures whose inferred types dominate, not all of them.

The probe also reports nine TS6307 and one TS6059. **Those are artifacts of the
probe's own config**, not code defects: it sets `rootDir: "."`, so a JSON import
in `ee/billing` and `scripts/generate-langy-skills.ts`'s import of
`../../skills/_lib/frontmatter.ts` fall outside its file list. The app tsconfig
is fine with both. Do not chase them.

### Phase 2 — break the `app-layer` ↔ `event-sourcing` cycle

Make the dependency one-way: `event-sourcing` must not import `app-layer`.

The 129 reverse edges are the deliverable. Most are expected to be one of
three shapes, and each has a standard fix:

- reaching for a **service** to do work → invert it: the pipeline declares a
  port, the composition root supplies the implementation (the pattern ADR-062's
  `scenarioExecutionDispatch` already uses);
- reaching for a **shared type** → move it down into `@langwatch/domain` or
  `@langwatch/contracts`, where both sides may see it;
- reaching for `getApp()` → the composition root is a transport-layer concern;
  it may be injected but never imported downward.

Only when this is a DAG can either side become a package. Attempting the split
before it is the failure mode that makes a large refactor unmergeable.

### Phase 3 — extract one domain at a time

Per domain (traces, simulations, experiments, langy, automations), in this
order: repositories, then services, then routes. Each domain ships as its own
PR and its own `@langwatch/<domain>` package, and each is independently
revertible.

The cleanups the ask names ride **inside** each extraction, not as a separate
sweep: typed `HandledError` at the boundary, one logger per package with a
stable name, routes moved out of the service they call. Touching a file twice
is the expensive part, and a move already forces a review of every import.

## Consequences

- **This is not one change.** The ask is "all in one go"; the evidence says the
  one-go version cannot merge. #6018 was the tractable subset — 526 files —
  and still closed unmerged. The local full typecheck is RAM-banned, so every
  round-trip to green runs through CI; a 3,000-file branch would spend days in
  that loop while main moves under it. Sequenced phases each go green on their
  own and none is wasted if the next is deferred.
- Phases 0 and 1 deliver value even if 2–4 never happen: the composite graph
  stops triple-checking the tree, and explicit `.output()` schemas tighten the
  API surface.
- Phase 2 is the one with no visible output. It moves no files into packages
  and ships no feature; it only turns a cycle into a DAG. It is also the phase
  that decides whether the rest is possible, so it should not be traded away
  for something more demonstrable.
- Declaration emit is what buys the typecheck win. All current workspace
  packages are source-only (`main: src/index.ts`), so today they give zero type
  isolation; with `skipLibCheck`, emitting `.d.ts` makes a package's internals
  nearly free for its consumers.
- ADR-061 and ADR-062 land inside `src/server` and move with it. Sequencing
  them before Phase 2 keeps them small; doing them during a package move would
  put an execution-path change and a 500-file move in one diff.
- The root `pnpm-workspace.yaml` deliberately excludes `langwatch/` so
  `@langwatch/server-cli` can be tarball-packaged. Consolidation must preserve
  that exclusion.

## References

- `refs/pull/6018/head` — the recoverable first attempt
- `langwatch/tsconfig.emit-probe.json` (on that ref) — the TS7056 measurement
- [`dev/docs/best_practices/vitest-performance.md`](../best_practices/vitest-performance.md)
