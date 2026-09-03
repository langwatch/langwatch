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
| ~~`features/onboarding`~~ | 33 | 4,694 | **MOVED to `@langwatch/onboarding-web`** — the directory is gone from `platform/app`, reunited with the 54 files the traces move had taken into `@langwatch/trace-web`. |
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

---

# Second census — 2026-09-02

Taken the same day as the first, after the UI, worker and tRPC waves landed.
`runtime/ui/legacy-page-loaders.ts` is now an **empty registry**, the worker
composes entirely from `apps/worker`, and `apps/api` mounts the tRPC record — so
none of the three roots that held half the tree open in the first census exist
any more. What remains is a server tree.

The method is unchanged (esbuild resolver, every `src` file as its own entry,
all imports external, `onResolve` records `(importer, resolved, kind)`), with
two refinements the first pass did not need. Both are in the classifier, and
both matter now that most of what is left is reachable rather than orphaned.

## What changed in the method

**Type-only holds are no longer expanded.** The first census held back any
candidate a surviving file still names. Applied transitively that resurrects
whole chains: one `import type { CustomGraphInput } from "~/components/analytics/CustomGraph"`
in `report-chart.service.ts` dragged `CustomGraph.tsx` back, and with it
`features/errors`, `utils/api.tsx`, `useOrganizationTeamProject`, `auth-client`
and eleven more files that nothing loads. A reference is now classified before
it is honoured: a **runtime** reference (esbuild's value graph, plus
`vi.importActual` and a bare `vi.mock(spec)` with no factory) holds the target
*and its dependencies*; a **type-only** reference holds the named file and
stops there, because nothing loads it.

**A test dies with its subject, not with its neighbours.** Three rules,
in order:

- A spec that names a platform module which no longer exists is residue. Nothing
  in a deletes-only tree can restore the module.
- A spec whose subject is in the delete set dies with it — including when it
  reaches that subject through `await import()`. `LLMModelCostDrawer.lite-member.integration.test.tsx`
  loads the drawer lazily; the drawer is gone, so the test has nothing to assert
  on. Lazy breakage does not travel *onward*, so the edge is taken once and the
  result then propagates over eager edges only.
- A spec that is red only because a **still-to-move** file it imports has a
  broken import is **kept**. It moves with that file. 226 surviving platform
  files have at least one import that resolves to nothing, and 95 surviving
  specs are red today because of it. Deleting them would throw away the tests
  for code the migration has not finished moving.

That last rule is the difference between the two censuses. The first ran while
the UI was being carved out and most red tests genuinely had no subject left;
this one runs against a tree where the red is mostly other agents' in-flight
server moves.

## What was deleted

Pure `rm`, never `git rm`, never staged. `git diff --numstat` over the manifest
reports **0 insertions on all 230 rows**.

| Tier | What | Files | Lines |
| --- | --- | ---: | ---: |
| A | product modules no live root reaches (components, hooks, model-provider settings UI, the browser entry) | 121 | 20,130 |
| B | specs whose subject is in tier A, or which name a module already gone | 92 | 19,821 |
| C | test-support helpers no surviving spec needs | 17 | 1,954 |
| | **total** | **230** | **41,905** |

`platform/app/src` went **1,145 → 915 code files** and **245,866 → 203,721
lines** across the census window (the ~240-line difference from the manifest is
other agents deleting concurrently). Non-test lines are now **115,271**.

A second pass over the deleted tree returns **empty** — the fixed point is
reached in one round, because the classifier computes the orphaned-test wave in
the same fixed point as the product deletions rather than after them.

The whole browser residue went in tier A: `main.tsx`, `runtime/ui/legacy-page-loaders.ts`
(the empty registry) and `runtime/ui/legacy-ui-shell.adapter.tsx`, plus
`components/settings/**` (21 files, the model-provider settings surface),
`components/projects/**`, `components/upgrade-modal/**`, `features/errors/components/**`,
24 `hooks/**` and `utils/{api,auth-client}.tsx`. Server-side: `server/rbac/{custom-role-permissions,role-binding-resolver}.ts`,
`server/middleware/rate-limit-langy.ts`, `server/queues/makeQueueName.ts`,
`server/data-privacy/legacyPrivacyMapping.ts`, `server/data-retention/resolveRetentionDays.ts`,
`server/modelProviders/{geminiDoor,modelProvider.authz}.ts`, `server/tracer/span-event-processing/strands-agents.ts`.

### Held back on purpose

Ten. Nine are named as a **type only** by a surviving platform file, which the
value graph cannot see — `server/app-layer/{dependencies,subscription/subscription.service,subscription/subscription.repository}.ts`,
`server/app-layer/evaluations/{types,evaluation-execution.types}.ts`,
`server/{scopes/scope.types,webhooks/destinations/types,schemas/sign-up-data.schema}.ts`,
`types/next-stubs.ts`. They go when their type consumers go, and every one of
them was held for the same reason in the first census.

The tenth is not a platform reference at all:
`packages/features/analytics/web/src/ui/sections/__tests__/langwatch-ql-workbench.integration.test.tsx`
calls `vi.importActual("~/utils/compat/next-router")`. A **package test loads a
platform module for real**.

## The live roots now

```
  node                                       browser
  ────                                       ───────
  apps/api          apps/worker              (none — apps/ui owns the route
       │                 │                    table AND the page modules; the
       ▼                 ▼                    platform SPA entry was deleted
  server/api/root.ts    runtime/app/**        by this census)
  (532 lines)          runtime/api/**
  server/api-router.ts      │
  src/app/api/**            │
  src/mcp/**                ▼
  server/better-auth/**  server/app-layer/**  ◄── src/tasks/**
  src/instrumentation*.ts   (139 files)           src/instrumentation*.ts
       │                        ▲
       └────────────────────────┘

  packages/features/gateway/server/**  ──►  ~/env.mjs, ~/server/db,
  (7 files, WRONG DIRECTION)                ~/server/app-layer/app,
                                            ~/features/errors/logic/presentation
```

| Root | Seeds | Closure |
| --- | ---: | ---: |
| `src/tasks/**` | 17 | 404 |
| `src/instrumentation*.ts` | 3 | 318 |
| `server/api-router.ts` | 1 | 336 |
| `runtime/{app,api}/**` | 111 | 221 |
| `server/api/root.ts` | 1 | 180 |
| `src/app/api/**` | 30 | 93 |
| `server/better-auth/**` | 6 | 61 |
| `src/mcp/**` | 3 | 27 |
| `apps/**` + `packages/**` importers | 6 | 64 |
| configuration (`scripts/`, `e2e/`, `prisma/`, `vite*/`, `vitest*`) | 36 | 498 |

`server/api/root.ts` is down to **532 lines** (2,236 at the first census, 1,203
and then 1,010 as the API halves landed). It is no longer the thing holding
platform open, and neither is any single transport: `server/app-layer` is, at
139 files and 34,982 lines, with `presets.ts` alone still 3,973 of them.

## What is still the last copy, and who should own it

916 files. Grouped by the package or app that should end up holding them
(full per-file manifest with its reaching root in `still-to-move.txt`):

| Owner | Files | Lines |
| --- | ---: | ---: |
| `apps/api` — REST transport (`server/routes/**`, `src/app/api/**`, `pages/api/**`) | 87 | 22,369 |
| `apps/api` + `apps/worker` composition root (`runtime/app/**`, `server/app-layer/*`) | 105 | 25,465 |
| `@langwatch/trace-server` | 45 | 12,478 |
| `@langwatch/experiment-server` (`server/experiments-v3/**`) | 19 | 9,157 |
| `apps/api` — tRPC transport (`server/api/**`) | 40 | 8,828 |
| `packages/ui` — client error presentation registry (`features/errors/**`) | 10 | 7,810 |
| `@langwatch/clickhouse-client` (+ migration ownership) | 33 | 7,495 |
| `apps/{api,worker,ui}` test harness (`test-utils/**`, root `__tests__/**`) | 41 | 7,304 |
| `@langwatch/eventing` (`server/event-sourcing/**`) | 19 | 6,742 |
| `@langwatch/identity-server` | 37 | 5,868 |
| `@langwatch/system-migrations` | 17 | 5,248 |
| `apps/worker` task lane (`src/tasks/**`) | 26 | 5,206 |
| `@langwatch/stored-object-server` | 16 | 4,863 |
| `@langwatch/data-privacy-server` | 20 | 4,835 |
| `apps/api` — MCP transport (`src/mcp/**`) | 4 | 4,145 |
| `@langwatch/analytics-server` (`server/export/**`) | 16 | 4,124 |
| `@langwatch/organization-server` | 9 | 3,962 |
| `@langwatch/auth-server` (incl. `server/better-auth/**`) | 17 | 6,386 |
| `@langwatch/billing-server` (enterprise) | 19 | 2,989 |
| `@langwatch/model-provider-server` | 16 | 2,613 |
| `@langwatch/evaluation-server` | 11 | 2,468 |
| `@langwatch/webhook-server` (enterprise) | 16 | 2,223 |
| everything else (28 owners) | ~180 | ~25,000 |

**The 5-file knot.** `server/app-layer/{presets,app,dependencies,config,index}.ts`
is 5,551 lines and every server root lands in it. Nothing under it moves
cleanly until it is split by feature; that was the first census's finding and it
is unchanged.

## Non-`src` content

Classified, not deleted.

**move to `apps/ui`** — `index.html` (the SPA shell; `apps/ui` has no HTML entry
of its own yet), `public/**` (90 files: favicon, fonts, images), `vite.config.ts`,
`vite/havenHmrGate.ts` + test, `vitest.browser.config.ts`,
`vitest.component.config.ts`, `test-setup.browser.ts`, and the browser-facing
half of `specs/**` (components, home, settings, sidebar, studio, langy, presence,
monitors, scenarios, model-providers, period-selector, usage-indicator-display).
`e2e/**` (63 files, Playwright) goes with it, except `e2e/auth-regression/**`,
which imports `~/server/{db,prismaPgAdapter,better-auth,auth}` and moves with
the auth vertical.

**move to `apps/api` / `apps/worker`** — `scripts/{build-server.mjs,build-mcp-server.sh,bundle-optional-externals.mjs,start.sh,run-task.sh}`;
the OpenAPI guards (`check-openapi-completeness.ts`, `check-openapi-route-coverage.ts`,
`openapi-route-exclusions.ts`, `scripts/lib/hono-route-table.ts` and their
`__tests__`); `check-gateway-control-plane.ts`; `generate-task-registry.mjs` and
`scripts/migrations/**` and `scripts/ops/**` to the worker task lane; and the
whole test harness — `vitest.config.ts`, `vitest.integration.config.ts`,
`vitest.{pg,prisma,stripe}-integration.config.ts`, `vitest.stress.config.ts`,
`vitest.sequencer.ts`, `vitest.durations.json`, `test-setup.ts`. The harness is
load-bearing for the **whole repository**: root `pnpm test:unit` /
`test:component` / `test:integration` still resolve to `@langwatch/web`, so
these move only together with repointing the root scripts.

**move elsewhere** — `prisma/{seed,seed-demo-platform,demo-platform-ids}.ts` to
`@langwatch/prisma-client`, which already owns the schema and the migration
history. `scripts/check-feature-parity.ts`, `check-ports.sh`, `kill-dev-tree.sh`,
`refresh-dev-s3-env.sh` and the `check-queue` / `check-shims` tests are
repository tooling (CI and the `Makefile` reference them by path) and belong
under `dev/scripts` or `tools/`.

**keep until cutover** — `package.json` (`@langwatch/web`), the five
`tsconfig*.json`, `prisma.config.ts` (its own docblock says "transitional
monolith composition only"), `vendor/langwatch-scenario-1.3.0.tgz` (a `file:`
dependency in the lockfile — it moves with whoever inherits the scenario
dependency), and `scripts/dogfood/**` (58 files) with the `seed-*`, `report-*`,
`update-*`, `_dogfood_*` and `_qa-*` operator scripts. Those last only need a
Prisma client and can be repointed at `@langwatch/prisma-client` in one pass at
cutover.

**delete now** — `vitest.mcp.config.ts`, `vitest.prisma-integration.config.ts`
and `tsconfig.slice-check.json` have no reference anywhere in the repository.
Left in place: this census's mandate was `src`.

## Two things worth acting on

**A package imports platform, which is the forbidden direction.** Seven files
under `packages/features/gateway/server/src/**` reach back into
`platform/app/src`: `~/env.mjs`, `~/server/db`, `~/server/app-layer/app`,
`~/server/app-layer/permissions/imperative`,
`~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service`
and `~/features/errors/logic/presentation`. That last one is the reason
`features/errors` (10 files, 7,810 lines — the client presentation registry
`CLAUDE.md` points customers' error copy at) is still alive in platform at all.
The gateway vertical moved; its imports did not.

**Two package suites cannot collect.**
`packages/features/trace/server/src/repositories/clickhouse/__tests__/{trace-summary,trace-analytics}.repository.integration.test.ts`
import `startTestContainers` from
`../../../../../../../../platform/app/src/server/event-sourcing/__tests__/integration/testContainers`,
which no longer exists. Not caused by this census; found by it.

## Reproducing

Same five stages, and stage 5 is still not optional. This census watched
`platform/app/src` go from **1,255 to 1,146 files in forty-five minutes** while
other agents moved code out of it — the `server/app-layer/scheduler/` directory
disappeared between building the graph and reading the result. Build the graph,
gate the manifest (non-empty, disjoint from every root closure, nothing another
agent has staged or modified), `rm`, then re-run to a fixed point.
