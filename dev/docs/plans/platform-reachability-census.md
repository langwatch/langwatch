# Platform reachability census

`platform/app` is being dismantled: `apps/{api,worker,ui}` and `packages/features/*`
replace it, and the platform tree is deletes-only — it does not have to compile or
boot. This census answers the only question that matters while that is true: **what
under `platform/app/src` can still be reached from something that runs?** Everything
else is residue, and residue is what makes the remaining moves look bigger than they
are.

Taken 2026-09-02, on `feat/strict-feature-layout-v0`, while several agents were
moving code out of platform in the same hour. Numbers are a snapshot of a tree that
was shrinking under the measurement; the method is what is durable.

## The live roots

Five entry surfaces still pull platform code into a running process:

```
  browser                          node
  ───────                          ────
  @langwatch/ui route table        apps/worker job registry
        │                                │
        ▼                                ▼
  runtime/ui/legacy-page-loaders.ts   runtime/worker/**        runtime/app/**
  (36 lazy import() keys)             (job + capability wiring) (composition root)
        │                                │                          │
        │                                ▼                          │
        │                          server/routes/**  ◄──────────────┘
        │                          (Hono/REST mounts)
        ▼                                ▲
  pages/ components/ hooks/              │
  features/ experiments-v3/         server/api/root.ts
                                    (2,236-line tRPC record)
                                          │
                                          ▼
                                    server/app-layer/**  server/*
```

| # | Root | What it is |
| --- | --- | --- |
| 1 | `src/runtime/ui/legacy-page-loaders.ts` | the key→module install list `@langwatch/ui` hands the browser; every routed screen still in platform hangs off one of its lazy `import()`s |
| 2 | `src/server/api/root.ts` | the single tRPC record; still 2,236 lines at census time |
| 3 | `src/runtime/worker/**` | the job and capability wiring the packaged worker installs |
| 4 | `src/server/routes/**` plus the app entries (`src/server.mts`, `src/main.tsx`, `src/workers.ts`, `src/task.ts`, `src/runtime/app/**`) | the Hono/REST mounts and the composition root behind them |
| 5 | `src/generated/**`, `prisma/**`, `vite/**`, `vite.config.ts`, `vitest.*.config.ts`, `test-setup.ts`, the build/codegen scripts | generated files and configuration |

Config roots are seeded twice: once from their `import`s, once from every string
literal naming a path under `src/` (`globalSetup`, alias tables, and other
string-keyed wiring that no import statement reaches).

## Method

A regex import scan was tried first and was wrong in both directions, so the graph
is built by **esbuild's own resolver** with the repo's `~/` → `src/` and `@app/` →
`src/server/app-layer/` aliases. Every `.ts`/`.tsx`/`.mjs` file under `src` is fed
in as its own entry with all imports marked external, so nothing links and nothing
is bundled; the plugin's `onResolve` records `(importer, resolved, kind)` and every
specifier that resolves to nothing. One pass, ~3,400 files, no TypeScript session.

Three properties of that graph decide everything downstream:

- **Type-only imports are already gone.** esbuild erases `import type` before
  `onResolve` sees it, so the value graph is the graph that actually loads. That
  also means a module referenced *only* as a type looks unreachable — see the
  safety net below.
- **Edge kind is recorded.** `import-statement` and `require-call` are eager: a
  broken import anywhere in that closure kills the importer at transform time.
  `dynamic-import` is not: vite resolves the literal specifier at the importer's
  transform time (a *missing* target breaks the importer — this is exactly how the
  `pages/index` loader key broke the whole `runtime/ui` suite) but does not
  transform the target until it is called, so breakage does not travel onward
  through it.
- **`vi.mock(spec, factory)` cuts the edge** for that test file's whole closure —
  vitest replaces the module, so the real one is never transformed and its broken
  dependencies never surface.

Two more edge classes were checked and found absent: `import.meta.glob` and
non-literal `import(expr)` / `` import(`...`) ``. There are none in `platform/app/src`,
so the literal-specifier graph is complete.

**Safety net for type-only references.** Before deleting any non-test candidate,
every surviving platform file (plus `scripts/`, `e2e/`, `vite/`, `prisma/`) is
re-scanned at the text level with the same resolver, `import type` included. A
candidate any surviving platform file still names is held back. Files named only
from `packages/**` or `apps/**` were checked by hand: those are provenance comments
in the already-migrated copies, not imports.

**Verification, not inference.** The classifier's claim — "this test cannot even
collect" — was checked against the real runners, not argued:

| Lane | Predicted red | Confirmed 0-test | False positives |
| --- | ---: | ---: | ---: |
| `test:unit` | 272 | 268 | 4 |
| `test:component` | 339 | 329 | 10 |

The 14 false positives were fed back as an explicit exclusion list and their causes
fixed in the model (a `vi.mock` of a nonexistent path is not an error when a factory
is given; specifiers escaping `src/` into `scripts/` resolve fine). A 30-file sample
of files classified *green* collected and passed 316 tests, with 2 failing for a
cause the model cannot see (a `vi.mock` factory whose hoisting still drags the
original in) — those stay, which is the safe direction.

The remaining ~460 datastore-lane integration tests could not be run here. They
carry the residual risk of the same ~1.5% false-positive rate observed above.

## What was deleted

Pure `rm`, never `git rm`, never staged. `git diff --numstat -- platform/app`
reports **0 insertions on all 2,267 rows**.

| Tier | What | Files | Lines |
| --- | --- | ---: | ---: |
| A | pages / components / hooks / features no loader key reaches | 38 | 3,937 |
| B | server, `app/api`, `utils` modules nothing imports | 23 | 8,190 |
| C | orphaned tests — cannot load, subject gone | 1,090 | 356,601 |
| C2 | test helpers no surviving test needs | 7 | 787 |
| | **total** | **1,158** | **369,515** |

Deletion ran to a fixed point: removing tier A/B orphaned a second wave of tests
(10 files), which orphaned a third (4 files), after which the census returns empty.

Notable tier-B removals: the whole legacy `server/analytics/clickhouse/` cluster
(`aggregation-builder`, `metric-translator`, `filter-translator`, `field-mappings`,
5,784 lines) — already copied to `packages/features/analytics/server/src/clickhouse/`
and imported by nobody in platform — and `server/tracer/otel.traces.ts` (1,471
lines), which had no importer at all.

### Held back on purpose

19 candidates. All but two are modules a surviving platform file still names **as a
type only**, which the value graph cannot see: `server/app-layer/dependencies.ts`,
`server/app-layer/scheduler/scheduler.types.ts`,
`server/app-layer/evaluations/{types,evaluation-execution.types}.ts`,
`server/{clickhouse,traces,filters/clickhouse}/types.ts`,
`server/webhooks/destinations/types.ts`, `server/stored-objects/storage-driver.ts`,
`types/next-stubs.ts`, `features/briefing/types.ts`,
`features/onboarding/regions/model-providers/types.ts`,
`components/agent-testing/{run/run-dialog-types,results/period-controls}.ts`,
`components/settings/ScopeFilter.tsx`, `hooks/useAvailableScopes.ts`,
`components/{AddMembersForm,scenarios/ScenarioFormDrawer}.tsx`,
`server/modelProviders/seedProviderCredential.ts`,
`server/app-layer/subscription/subscription.service.ts`. They go when their type
consumers go.

`src/runtime/**` is excluded from tier C wholesale. 96 tests under `runtime/app`
are red today because of moves landing in the same hour; they are the migration's
own safety net and should be repaired or moved, not swept.

## The map: what is still reachable, and from where

Top 30 subtrees by lines, non-test files, generated JSON excluded. `loaders` alone
means **only** the browser route table reaches it — a UI subtree with no server
entanglement, which is the cheapest kind of move.

| Subtree | Files | Lines | Reached by |
| --- | ---: | ---: | --- |
| `server/app-layer` | 170 | 42,483 | loaders, trpc-root, worker, rest-routes, runtime-app, config |
| `features/langy` | 75 | 23,162 | loaders |
| `server/routes` | 41 | 18,220 | trpc-root, worker, rest-routes, runtime-app, config |
| `components/agent-testing` | 108 | 14,075 | loaders |
| `runtime/app` | 124 | 11,143 | loaders, trpc-root, worker, rest-routes, runtime-app, config |
| `components` | 42 | 9,827 | loaders |
| `server/traces` | 26 | 9,405 | trpc-root, worker, rest-routes, runtime-app, config |
| `components/settings` | 32 | 9,042 | loaders |
| `server/experiments-v3` | 16 | 7,946 | loaders, trpc-root, rest-routes, runtime-app, config |
| `experiments-v3/components` | 28 | 7,541 | loaders |
| `server/api` | 28 | 7,226 | loaders, trpc-root, worker, rest-routes, runtime-app, config |
| `hooks` | 41 | 5,665 | loaders |
| `features/errors` | 11 | 5,568 | loaders |
| `server/gateway` | 17 | 5,226 | trpc-root, worker, rest-routes, runtime-app, config |
| `utils` | 40 | 4,967 | loaders, trpc-root, worker, rest-routes, runtime-app, config |
| `components/suites` | 19 | 4,840 | loaders |
| `features/onboarding` | 33 | 4,694 | loaders, trpc-root, worker, rest-routes, runtime-app, config |
| `features/command-bar` | 34 | 4,473 | loaders |
| `app/api` | 30 | 4,167 | trpc-root, worker, rest-routes, runtime-app, config |
| `tasks` | 17 | 4,140 | rest-routes, runtime-app, config |
| `components/home` | 18 | 4,029 | loaders |
| `pages/settings` | 12 | 3,964 | loaders |
| `server/stored-objects` | 16 | 3,921 | trpc-root, worker, rest-routes, runtime-app, config |
| `experiments-v3/hooks` | 15 | 3,487 | loaders |
| `server` | 17 | 3,480 | loaders, trpc-root, worker, rest-routes, runtime-app, config |
| `features/briefing` | 10 | 3,112 | loaders |
| `server/data-privacy` | 12 | 2,984 | trpc-root, worker, rest-routes, runtime-app, config |
| `features/navigation` | 21 | 2,939 | loaders |
| `components/scenarios` | 15 | 2,907 | loaders |
| `pages/[project]` | 12 | 2,715 | loaders |

Split by which roots hold a file:

| Held by | Files | Lines |
| --- | ---: | ---: |
| the loader registry alone (pure UI) | 702 | 142,109 |
| more than one root (UI *and* server, or several server roots) | 690 | 154,805 |
| the composition root alone | 6 | 158 |
| configuration alone (test helpers, codegen inputs) | 55 | 8,653 |

## What the map says about the next moves

**Half the remaining platform surface is reachable only from the loader registry.**
702 files, 142,109 lines, no server root touching them. Each is a UI move that
changes exactly one line in `legacy-page-loaders.ts` and nothing else. The biggest
single blocks are `features/langy` (23,162), `components/agent-testing` (14,075),
`components/settings` (9,042), `experiments-v3/components` + `experiments-v3/hooks`
(11,028), `components/suites` (4,840) and `features/command-bar` (4,473).

**The shared half is one knot, and `server/app-layer` is its centre.** 170 files
and 42,483 lines reached by every root at once — the loader registry, the tRPC
record, the worker and the REST mounts all land in it. `presets.ts` alone is 3,973
lines. Nothing downstream of it moves cleanly until it is split by feature, so it
is the ordering constraint on the server half, not `server/routes` (18,220) or
`server/traces` (9,405), which are downstream of it.

**`server/api/root.ts` is still whole.** 2,236 lines at census close; the tRPC ports
extraction into `apps/api` had not landed. Its exclusive closure is small (321 files
shared with the other roots, none exclusive) — root.ts is not what holds platform
open; `app-layer` underneath it is.

**Re-run this before each wave.** The census is a script, not a document: rebuild
the graph, recompute the roots, and the newly-orphaned set falls out. Every move
out of platform orphans more than it removes — this pass deleted 1,158 files, of
which 14 became deletable only *because* the first wave landed.

## Reproducing

The census is a five-stage pipeline over one esbuild pass:

1. build the resolver graph (every `src` file as its own entry, all imports
   external, `onResolve` records edges and misses)
2. closure from each live root, separately, so ownership is attributable
3. "cannot load" closure over eager edges only, with `vi.mock` factory targets cut
4. type-inclusive text re-scan of every surviving file to hold back type-only
   references
5. fresh `git status --porcelain -- platform/app` immediately before `rm`, skipping
   anything another agent has in flight, then repeat to a fixed point

Stage 5 is not optional while other agents are moving code: this census was taken
against a tree that lost 947 files to other agents mid-measurement.

## Gate status at census close

Both platform runtime suites were **already broken by other agents' in-flight
moves** before this census deleted anything, and neither got worse:

- `pnpm test:unit run src/runtime/worker` — 8 files, 5 passed / 3 failed, 15 tests
  passed. Identical before and after. The 3 failures are `~/utils/constants` and a
  `@langwatch/analytics-web/validation` export, both other agents' moves.
- `pnpm test:unit run src/runtime/ui` — 1 file, fails to collect. The loader
  registry still names `~/pages/index`, `~/pages/[project]/studio/[workflow]` and
  `~/pages/share/[id]`, all deleted by another agent. Repairing it needs an edit to
  `legacy-page-loaders.ts`, which belongs to whoever is moving those pages.
- `src/env.mjs` was deleted by another agent while `test-setup.ts` still imports
  `./src/env.mjs`, which currently fails **every** platform test at setup. The
  worker figures above were taken with it temporarily restored, then removed again
  to leave that agent's tree exactly as found.
