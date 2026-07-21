# ADR-058: Modular Package Architecture — bounded-context packages for runtime footprint and type isolation

**Date:** 2026-07-21

**Status:** Proposed

**Related:** PR #6023 (runtime footprint: single-process dev, env-gated DLP/OTel), PR #6018 (`refactor/type-graph-split`: composite projects, `@langwatch/contracts`), ADR-004 (dev environment), ADR-052 (process-manager substrate), ADR-054 (observability-as-code). Supersedes the ad-hoc lazy-import experiments explored during the #6023 work.

---

## 1. Context

Two independent efforts have converged on the same root cause.

**Runtime footprint (PR #6023).** Profiling `pnpm dev` / `pnpm start` (Node 24, tsx over `src/`, 2026-07-21) measured a single server process reaching **~8,500 modules / ~500 MB resident**, whether or not the endpoints that need them are ever hit. The two-process dev default doubled it. We landed three point fixes (single-process default, env-gated Google DLP, need-based OTel instrumentation) but every further attempt (lazy-loading the AI SDK, CopilotKit, stripe) turned into whack-a-mole: a dependency deferred at one call site was still pulled in through another.

**Typecheck graph (PR #6018 / type-analysis, 2026-07-21).** The app tsgo project is **12,799 files (3,703 project + 9,019 dep `.d.ts`), 1.58 GB RSS** for `--listFilesOnly` alone. All workspace packages are source-only (no `.d.ts`), so there is **zero type isolation**. The merged tRPC `AppRouter` (~80 routers / ~516 procedures) is reachable from 337 frontend files, dragging the whole server type graph to the client.

**The shared root cause:** a single, boundary-less module graph with no enforced dependency direction. Both the RAM the process holds and the files the compiler re-checks are symptoms of the same missing structure.

### 1.1 The principle that governs everything below

> **Splitting code into packages does not, by itself, reduce runtime memory or typecheck cost. Dependency _direction_ does. Packages make direction _enforceable_ (a forbidden import fails to resolve) and _visible_ (the DAG is explicit).**

The concrete levers that follow from this:

- **Type-only cross-module edges.** If module A needs B, A imports `type BService from "@domain/b"` (an interface, elided at runtime) and receives the concrete instance by injection. A's runtime graph never pulls B's implementation.
- **A single composition root.** Only one place wires concrete implementations to interfaces, and it can wire them **selectively per process** (the ingestion process loads the OTLP transformer; a pure worker does not; a non-SaaS deployment never loads `ee`).
- **`.d.ts` boundaries.** With declaration emit (`skipLibCheck: true` makes package internals nearly free for consumers), a package's internals stop being re-checked by every downstream project.

### 1.2 Non-goals

- **Not microservices.** No network boundaries, no RPC tax, no distributed transactions. This is a modular monolith; the runtime is still `server.mts` + `workers.ts`. (Microservices were considered and rejected in the #6023 discussion: right tool for independent scaling, wrong — ~100× cost — tool for footprint.)
- **Not a Prisma rewrite.** Measured 2026-07-21: the 92-model connected relation graph is irreducible; the Prisma 7 split-generator gives ~zero per-consumer typecheck win and is a large, risky migration. Prisma is contained (Section 4.2), not replaced.
- **Not a quick memory fix.** This is an architecture investment measured in months. The immediately landable footprint wins (the `ee` seam, `otel-api` isolation) are called out explicitly so they can ship without waiting for the whole thing.

---

## 2. Decision

Restructure `langwatch/` into a strict, acyclic DAG of bounded-context packages. Concretely:

1. `event-sourcing` becomes a **pure library** (the event-sourcing machinery only); its domain **pipelines move to `app-layer/{namespace}`** next to the services they orchestrate.
2. Each domain (`user`, `projects`, `traces`, `evaluations`, `experiments`, `prompts`, `simulations`, …) becomes a **contract-sealed module**: a public, type-only `contract`, a privileged `wire` factory, and **internals that are physically unreachable** from outside.
3. API surfaces are split **by protocol**: `api` (Hono REST), `otel-api` (OTLP receiver — owns the heavy `@opentelemetry/otlp-transformer`), `trpc-api` (routers + `AppRouter`).
4. `ee` is an **optional composition seam** (null-object when not licensed / not SaaS).
5. `ui` depends on `trpc-api` **types only** and is **build-time only** — never in a Node runtime.
6. `server` is the **composition root**: the only package that pulls implementations, doing **selective per-process composition**.

---

## 3. Target architecture

### 3.1 The DAG

```
  shared            (zod contracts, DTO types, pure utils)                  ← everyone
    │
    ├── db            (Prisma client + repositories)        → shared
    ├── observability (telemetry EMISSION SDK)              → shared        ← everyone emits through it
    │
  event-sourcing (LIB: runtime pipeline, projections framework, outbox,
                  group-queue, replay, stores, reactor framework)
                                                            → db, observability, shared      [0 app-layer deps]
    │
  app-layer/{ns}   (domain services + their pipelines; each a sealed module)
                                                            → event-sourcing, db, observability, shared
                                                            (+ other domains' CONTRACTS, type-only)
    │
    ├── ee           (billing / governance / admin)         → app-layer, db, …   [OPTIONAL — one seam]
    │
    ├── otel-api     (OTLP receiver; owns @opentelemetry/otlp-transformer)
    │                                                       → app-layer/traces, event-sourcing, shared
    ├── api          (Hono REST: collector, traces, datasets, …)
    │                                                       → app-layer, …
    └── trpc-api     (routers + AppRouter)                  → app-layer, …       [blocked: KNOT 2 / TS7056]
                          │
  ui   (React SPA)  ──────┘  depends on trpc-api TYPES ONLY (AppRouter type) + shared
                             BUILD-TIME ONLY — never loaded in a Node process
                          │
  server  (server.mts / workers.ts / start.ts / api-router)
          → api, otel-api, trpc-api, observability; loads ee through the seam
          the ONLY package that imports `wire` factories and constructs the graph
```

### 3.2 Package inventory

| Package | Contents | Depends on | Heavy deps it _contains_ | Maps to (today) |
|---|---|---|---|---|
| `shared` | zod contracts, DTO types, pure utils | — | — | `@langwatch/contracts` (#6018) + `src/shared`, `src/utils` leaves |
| `db` | Prisma client, repositories, multitenancy guard | shared | `@prisma/client` | `src/server/db`, `**/repositories` |
| `observability` | `setupObservability`, `createLogger` | shared | (SDK, but small) | `langwatch/packages/observability` (exists) |
| `event-sourcing` | runtime pipeline, projection framework, outbox, group-queue, replay, stores, reactor framework | db, observability, shared | `bullmq`, `ioredis` | `src/server/event-sourcing/*` **minus** `pipelines/` |
| `app-layer/{ns}` | domain services + their pipelines, sealed | event-sourcing, db, observability, shared; other domains' contracts (type-only) | domain-specific | `src/server/app-layer/{ns}` + rehomed `pipelines/{ns}-processing` |
| `ee` | billing (stripe), governance, admin | app-layer, db, event-sourcing, shared | `stripe` (~136 modules), `@google-cloud/dlp` (governance) | `ee/` (exists) |
| `otel-api` | OTLP receiver, collector mapping | app-layer/traces, event-sourcing, shared | **`@opentelemetry/otlp-transformer` (~54 modules / 1.8 MB)** | `src/server/routes/otel.ts`, `routes/ingest/`, `tracer/collector/`, `src/server/otel/` |
| `api` | Hono REST routes | app-layer, db, shared | (route-specific) | `src/server/api-router.ts`, `src/server/routes/*`, `src/app/api/*` |
| `trpc-api` | tRPC routers, `AppRouter` | app-layer, db, shared | — | `src/server/api` (routers/root) |
| `ui` | React SPA | trpc-api **types**, shared | React/Chakra/Ark (build-time) | `src/{components,features,pages,app,optimization_studio,hooks,stores}` |
| `server` | entrypoints + composition root | api, otel-api, trpc-api, observability; ee via seam | — | `server.mts`, `workers.ts`, `start.ts` |

### 3.3 Dependency rules (invariants the tooling must enforce)

1. **Acyclic.** No cycles between packages. (Cycles _within_ a package are tolerated; cycles _across_ are not.)
2. **Cross-domain edges are contracts, type-only.** `app-layer/experiments` may import `type TracesService from "@domain/traces"`; it may **not** import `@domain/traces`'s implementation, repository, or service class.
3. **`ui` imports server packages' _types only_.** No value import from `db`, `app-layer`, `api`, `trpc-api` reaches `ui`. (This is the reverse-edge fix — see 4.2.)
4. **`ee` is reached only through the seam** (Section 4.5). No package other than the composition root and the seam imports `ee`.
5. **`server` is the only package that imports `wire` factories.** Everyone else consumes contracts.

---

## 4. Design details

### 4.1 The layer leaves: `shared`, `db`, `observability`, `event-sourcing`

- **`shared`** is the type/contract leaf. Largely started in #6018 (`@langwatch/contracts`: tracer / traces-v2 / datasets / filters / scenarios / llm-parameters, ~460 import sites rewritten). Pure zod + types + framework-free utils. Declaration emit on.
- **`db`** contains the Prisma client and the repository layer, plus the multitenancy `$use` guard. This is where the "contain Prisma" work lands (Section 4.2). Repositories expose `findAll`/`findById`; services (in `app-layer`) expose `getAll`/`getById` and are the only callers of repositories (existing convention, now enforced across a package boundary).
- **`observability`** is the telemetry _emission_ SDK (exists as `langwatch/packages/observability`). Distinct from `otel-api`, which is the _ingestion_ receiver. Everyone emits through `observability`; only the ingestion process depends on `otel-api`.
- **`event-sourcing`** becomes a pure library after the pipelines move out (Section 5.1). It owns: the runtime pipeline runner, the projection framework, the outbox, the group-queue (with the lease-based blob lifecycle from #5947), replay, stores, and the reactor _framework_ (not concrete reactors). Zero `app-layer` dependencies — it is publishable in principle.

### 4.2 Contract-sealed domain modules (the core of the plan)

Today `app-layer/projects/` is `project.service.ts` + `repositories/` with everything importable. Target shape:

```
app-layer/projects/               (later: packages/domain-projects/)
  package.json   exports: { ".": "./contract.ts", "./wire": "./wire.ts" }
  contract.ts    ── PUBLIC, TYPE-ONLY. The entire public surface:
                      export interface ProjectService {
                        getById(input: { projectId: string }): Promise<Project>;
                        …
                      }
                      export type Project = { … };            // DTOs
  wire.ts        ── PRIVILEGED. Imported by the composition root ONLY:
                      export const createProjectService =
                        (deps: { db: Db; teams: TeamsService }): ProjectService => …
  project.service.ts   ── internal impl: class ProjectServiceImpl implements ProjectService
  repositories/        ── internal — NO exports entry → unresolvable from outside the package
```

**The rule that makes it a footprint win, not just hygiene:** domains depend on each other's `contract` (type-only), never their implementation. Runtime instances arrive by injection at the composition root:

```ts
// a consumer domain — imports a TYPE, elided at runtime
import type { TracesService } from "@domain/traces";
export const createExperimentsService =
  (deps: { traces: TracesService; db: Db }): ExperimentsService => …

// the composition root (this is TODAY'S presets.ts `initializeDefaultApp` / getApp())
const traces      = createTracesService({ db, … });
const experiments = createExperimentsService({ traces, db });   // wire concrete → interface
```

Because cross-domain edges are type-only, each domain's **runtime** graph shrinks to its own internals + injected interfaces. **Only the composition root pulls implementations** — and it pulls them _selectively_.

**We already have the seam.** `getApp()` is a composition-root singleton, and services already reach each other through `getApp().projects / .traces / .langy / …` rather than importing each other's impl. The pivotal change is **retyping `getApp()` to return contract interfaces** instead of concrete implementations — that single change forces every consumer onto contracts and surfaces every illegal reach-through as a type error.

**Enforcement (internals genuinely unreachable):**

- **Package `exports` map** — only `.` (contract) and `./wire` resolve; `repositories/`, `*.service.ts` have no entry, so Node/bundler _cannot_ import them. Strongest; requires the physical package move.
- **Interim, in-monolith:** `eslint-plugin-boundaries` / `no-restricted-imports` banning `app-layer/*/repositories` and `app-layer/*/*.service` from outside the owning domain. Lands _before_ the package move and is the ratchet that keeps new code honest during the migration.

### 4.3 API surface packages (split by protocol)

- **`otel-api`** — the OTLP receiver (`POST /api/otel/v1/{traces,logs,metrics}`, `routes/ingest/`, `tracer/collector/`, `src/server/otel/`). It is the **sole consumer of `@opentelemetry/otlp-transformer`** (the protobuf decoder stack — 54 modules / 1.8 MB, the 3rd-heaviest package in the boot census). Isolating it means any process that does not receive OTLP (a pure worker, the UI-serving process) never loads it. Feeds `app-layer/traces` (the trace pipeline).
- **`api`** — the Hono REST surface (collector, traces, datasets, model-providers, …). Depends on `app-layer` contracts.
- **`trpc-api`** — the tRPC routers and the merged `AppRouter`. **Blocked on KNOT 2** (Section 6.2) until `AppRouter` is shrunk enough to cross a `.d.ts` boundary.

### 4.4 `ui` as a build-time, types-only consumer

`ui` imports **only** `trpc-api`'s `AppRouter` type (via `@trpc/react-query`) and `shared` DTO types. No server value ever enters the client bundle, and — critically for footprint — **`ui` is never loaded in a Node process**. This is also the fix for the measured reverse edges (server code today transitively pulls React/Chakra/Ark UI — ~1,250 modules / ~1.8 MB — because a handful of server files import `~/components/*`; those imports become type-only or move to `shared`).

### 4.5 `ee` as an optional composition seam

`ee` (billing/governance/admin) is already physically separate. The code _already_ null-objects it for non-SaaS (e.g. `subscription.ts`: `env.IS_SAAS ? createSubscriptionRouter() : emptyRouter`). The only defect is eager imports. The clean form is a single typed seam:

```ts
// packages/ee/load.ts  (tiny; import type only, so importing it pulls nothing)
import type * as EE from "./index";
export const loadEE = (): typeof EE => require("./index");   // CJS; loaded only when called
```

The composition root calls `loadEE()` only when licensed/SaaS; otherwise it wires null-objects. `stripe` (~136 modules) and DLP's grpc/protobuf stack never enter a non-SaaS runtime. This replaces the scattered `require(...) as typeof import(...)` casts explored during #6023 with one seam, and it is **landable now** (Phase 1).

---

## 5. The two structural knots and how this dissolves them

### 5.1 KNOT 1 — the `app-layer ↔ event-sourcing` cycle (dissolved, not worked around)

Measured: 226/191 mutual cross-imports across ~1,100 files. The cause is that the **domain pipelines live under `event-sourcing/pipelines/` but are domain logic** — they call `app-layer` services, creating the back-edges. Moving them home makes `event-sourcing` one-directional.

Verified (2026-07-21): the pipelines account for **54 of the 65** `event-sourcing → app-layer` back-edges. The mapping to existing homes:

| pipeline (leaves `event-sourcing/pipelines/`) | → app-layer home | status |
|---|---|---|
| `trace-processing` | `app-layer/traces` | exists |
| `automations` | `app-layer/automations` | exists |
| `evaluation-processing` | `app-layer/evaluations` | exists |
| `langy-conversation-processing` | `app-layer/langy` | exists |
| `log-processing` | `app-layer/logs` | exists |
| `metric-processing` | `app-layer/metrics` | exists |
| `simulation-processing` | `app-layer/simulations` | exists |
| `suite-run-processing` | `app-layer/suites` | exists |
| `topic-clustering-processing` | `app-layer/topic-clustering` | exists |
| `billing-reporting` | `app-layer/billing` | exists |
| `experiment-run-processing` | `app-layer/experiments` | **new** (only one) |

The residual **11 lib→app-layer leaks** to cut so `event-sourcing` is a truly pure lib: `pipelineRegistry.ts`, `pipeline/types.ts`, `eventSourcing.ts`, `reactors/reactor.types.ts`, `projections/projectionRegistry.ts`, `projections/projectionRouter.ts`, `queues/groupQueue/tieredBlobStore.ts`, `replay/replayExecutor.ts`, `replay/replayPreset.ts`, `services/eventSourcingService.ts`, `services/eventSourcingService.types.ts`. Most are the registry/router files that enumerate concrete pipelines (they should take the registry as data, injected by the composition root, rather than importing pipelines).

### 5.2 KNOT 2 — `AppRouter` TS7056

The ~80-router / ~516-procedure merged `AppRouter` type exceeds tsgo's serialization limit, so it cannot cross a `.d.ts` boundary — which blocks both the `trpc-api` package emit and the `ui`-types-only edge. Two forces shrink it:

1. **Explicit `.output()` schemas** on the fat procedures, so the router's type is the declared output, not a deep inference through the service graph.
2. **Contract-first services** (Section 4.2): routers that consume typed _contracts_ instead of inferring through implementations produce a far smaller inferred type. The contract work and the AppRouter work reinforce each other.

`langwatch/tsconfig.emit-probe.json` (committed in #6018) measures the gap; the remaining errors are the `AppRouter` cluster.

---

## 6. Migration plan (phased, step-by-step)

Each phase is independently valuable and, where marked, **independently shippable**. Ordering is by dependency + unblock-value, with footprint wins pulled as early as they are safe.

### Phase 0 — Foundations (mostly landed in #6018)

- **0.1** Composite projects + `tsgo -b` to stop triple-checking (editor tsconfig, app tsgo, tests tsgo each re-check the graph). _Done in #6018._
- **0.2** Extract the `shared`/`@langwatch/contracts` leaf with declaration emit. _Done in #6018 (~460 import sites)._
- **0.3** **Enforcement scaffolding:** add `eslint-plugin-boundaries` with the DAG encoded as rules, initially in **warn** mode. This is the ratchet — every subsequent phase flips a rule to **error** as it completes. _Ship independently._

**Validation:** `typecheck:packages` (tsgo `--build` of the composite packages) green; eslint boundaries reports the current violation set as the migration backlog.

### Phase 1 — Landable footprint wins (independent of the big refactor) — SHIP NOW

- **1.1 `ee` composition seam.** Implement `loadEE()` (Section 4.5); route the composition root + the `subscription` tRPC router through it. Result: `stripe` (~136 modules) and the ee/billing subscription graph out of every non-SaaS runtime. **Ships on the #6023 line.**
- **1.2 Continue #6023's env-gating pattern** where a config flag already exists (this is the _structural_ home for the DLP/OTel gating already shipped).

**Validation:** boot-check census — `stripe` and `google-gax` = 0 modules with `IS_SAAS` unset; = present with it set; SaaS billing tests green.
**Footprint payoff:** immediate, per non-SaaS process. **Typecheck payoff:** none. **Ships independently:** yes.

### Phase 2 — `db` containment + the `getApp()` retype (the pivot)

- **2.1** Move Prisma + repositories into `db`. Cut the **64 frontend `~/server/db` value imports** — they become `type`-only imports of DTOs from `shared` (frontend needs the shapes, never the client). This is the biggest single reverse-edge cut.
- **2.2** **Retype `getApp()` to return contract interfaces.** This forces every consumer onto contracts and turns every illegal reach-through into a compile error — producing the exact backlog Phase 4 burns down.

**Validation:** CI full typecheck (RAM-banned locally — see §8); the `getApp()` retype will surface a wave of errors that _are_ the work-list.
**Footprint payoff:** modest (frontend no longer pulls the client). **Typecheck payoff:** large (client stops reaching the server value graph). **Ships independently:** 2.1 yes; 2.2 is a large coordinated change.

### Phase 3 — `event-sourcing` lib + pipelines home (dissolves KNOT 1)

- **3.1** Move each `pipelines/{ns}-processing` → `app-layer/{ns}` per the Section 5.1 table (create `app-layer/experiments` for the one new home).
- **3.2** Cut the 11 lib→app-layer leaks: convert the registry/router files to take the pipeline/projection registry as **injected data** rather than importing concrete pipelines.
- **3.3** Extract `event-sourcing` as a package with declaration emit; flip its boundary rule to **error** (no `app-layer` import allowed).

**Validation:** event-sourcing package unit + integration suites (testcontainers); the process-manager + group-queue suites are the load-bearing ones. Boundary lint = 0 `event-sourcing → app-layer` edges.
**Footprint payoff:** indirect (enables per-process composition). **Typecheck payoff:** large (breaks the ~1,100-file cluster). **Ships independently:** no — one coordinated cluster move.

### Phase 4 — Contract-seal the domains (incremental, per domain)

Apply the Section 7 recipe **one domain at a time**, leaf domains first:

- **4.1** Leaves (few cross-deps): `user`, `projects`, `teams`, `organizations`, `role-bindings`, `permissions`.
- **4.2** Mid-tier: `prompts`, `datasets`, `monitors`, `scheduler`, `usage`, `share`, `reports`.
- **4.3** Entangled cluster (draw contracts deliberately): `traces ↔ evaluations ↔ experiments ↔ simulations ↔ suites`, `langy`, `topic-clustering`, `metrics`, `logs`.

Each sealed domain flips its boundary rule to **error**.

**Validation:** per-domain unit suite + tslsp per-file; boundary lint. **Footprint payoff:** accrues (type-only edges prune each domain's graph). **Typecheck payoff:** accrues + feeds KNOT 2. **Ships independently:** yes — per domain.

### Phase 5 — API surface packages

- **5.1 `otel-api`** — extract the OTLP receiver + `@opentelemetry/otlp-transformer`. **Footprint win:** the transformer leaves every non-ingestion process. _Ships independently once `app-layer/traces` is a contract (Phase 4)._
- **5.2 `api`** — extract the Hono REST surface.
- **5.3 `trpc-api`** — **gated on KNOT 2.** First land the explicit `.output()` schemas on the fat procedures (§5.2); when the emit-probe is green, extract the package.

**Validation:** the API-endpoint-authorization audit (every route policy-registered) must stay green across the split; the real-router integration test (PR #5990) guards middleware ordering.

### Phase 6 — `ui` + `server`

- **6.1 `ui`** — depends on `trpc-api` types only (unblocked by 5.3). Confirm no server value import survives (boundary lint = error).
- **6.2 `server`** — the thin composition root: `server.mts`, `workers.ts`, `start.ts`, `api-router`. It performs **selective per-process composition**: the API process wires `api + otel-api + trpc-api`; a worker process wires only the pipelines + `event-sourcing`; `ee` only when licensed.

### Phase 7 — Realize and measure the footprint goal

- **7.1** Give each entrypoint its own composition (worker ≠ ingestion ≠ full API).
- **7.2** Re-run the boot-check census per process; confirm each pulls only its surfaces. Target: the worker process no longer loads `otel-api`, `ui` leaks, `trpc-api`, or `ee` (non-SaaS).

---

## 7. The repeatable domain-sealing recipe (one domain, step by step)

For a domain `X` under `app-layer/X/`:

1. **Draw the contract.** Create `contract.ts` with the public interface(s) (`XService`) and DTO `type`s. Import only `shared` + other domains' contracts (type-only). No `db`, no zod runtime, no framework.
2. **Make the impl implement it.** `X.service.ts`: `class XServiceImpl implements XService`. Do not export the class from any public entry.
3. **Extract the factory.** `wire.ts`: `export const createXService = (deps): XService => new XServiceImpl(deps)`. `deps` are typed by other domains' **contracts**, never impls.
4. **Seal internals.** Add the `exports` map (`.` → `contract.ts`, `./wire` → `wire.ts`). Delete any barrel that re-exports internals. (Interim: eslint boundary rule for the domain.)
5. **Rewire the composition root.** In `presets.ts` / `getApp()`, construct `createXService({ … })` and register it under the contract type.
6. **Rewrite consumers.** Anything that imported `app-layer/X/X.service` or `.../repositories` now imports `type XService from "@domain/X"` and receives the instance via `getApp().X` (contract-typed).
7. **Flip the rule to error.** The domain's boundary lint moves from warn → error; CI now forbids reaching its internals.
8. **Validate.** Domain unit suite + tslsp per-file + boundary lint = 0.

Do **not** batch domains: one PR per domain keeps the blast radius reviewable and the `getApp()` retype churn bounded.

---

## 8. Validation strategy

- **Per-file, fast:** `tslsp` diagnostics during edits. **Caveat (measured):** per-file tslsp cannot catch downstream _caller_ breakage or full-program ambient-scale interactions — only whole-program CI does.
- **Package-scoped:** `typecheck:packages` (`tsgo --build` of the composite packages) after each extraction.
- **Whole-program typecheck: CI only.** The app typecheck is RAM-banned locally (see `no-full-typecheck` — ~6 GB peak pins the laptop); each full-program fix round-trips through CI. Budget for that latency.
- **Footprint:** the boot-check census methodology from #6023 (import the boot graph under a CSS-noop hook, count `Module._cache` by package, diff on/off a config flag). Re-run per process in Phase 7.
- **KNOT 2:** `tsconfig.emit-probe.json` measures the `AppRouter` serialization gap.
- **Behavioral guards that must stay green across every phase:** the API-endpoint-authorization audit, the real-router request-duplication test (#5990), the process-manager + group-queue integration suites, the multitenancy `$use` guard.
- **Test runtime:** use `vmForks` (not `vmThreads`) — measured 2.56 GB → 573 MB peak RSS with `isolate:false`, CI-green across all shards (`vitest-performance.md`).

---

## 9. Risks, caveats, and honesty

- **This is months, not a sprint.** Coordinate with #6018 (`refactor/type-graph-split`) — same mechanism; do not fork it. The order is: land #6018's foundations, then this ADR's phases build on them.
- **Typecheck-_time_ win is ~nil; the value is organizational + enabling.** Measured in #6018: the shipped time delta is roughly zero once tooling exclusions are reverted; the value is contracts, clean boundaries, no double-include, and unblocking isolation once `AppRouter` is cracked. The same honesty applies to footprint: **moving files into `packages/` without cutting cross-imports buys nothing at runtime** — the win is the pruned, type-only graph + selective composition.
- **Prisma is irreducible.** The 92-model connected graph pulls ~everything from any entry point; the split-generator does not help. Contain it, do not chase it.
- **Contracts are real API commitments.** Draw bounded contexts deliberately (DDD), or contracts leak and the encapsulation is theatre. Circular _type_ contracts are fine; circular _impl_ wiring needs ordering at the composition root.
- **`getApp()` is value-imported by 64 frontend files today.** Those must move to contract types (Phase 2) before the retype (2.2), or the client re-drags the server graph.
- **Enforcement debt.** True internal-sealing needs `exports` maps (package moves); the eslint-boundaries interim is a ratchet, not a wall — new code can still cheat until the physical move lands. Flip rules warn → error the moment a boundary is real.
- **Root `pnpm-workspace.yaml` deliberately excludes `langwatch/`** (tarball packaging for `@langwatch/server-cli`); any consolidation must preserve that (see the comment in the file).

---

## 10. Sequencing summary

| Phase | Depends on | Footprint payoff | Typecheck payoff | Ships independently |
|---|---|---|---|---|
| 0 Foundations | — | — | enables | 0.3 yes |
| 1 `ee` seam | 0.3 | **now**, per non-SaaS process | — | **yes** |
| 2 `db` + `getApp()` retype | 0 | modest | large | 2.1 yes |
| 3 event-sourcing lib + pipelines home | 2 | enables per-process | large (breaks the cluster) | no |
| 4 contract-seal domains | 2, 3 | accrues | accrues + feeds KNOT 2 | **yes, per domain** |
| 5 API packages (`otel-api`/`api`/`trpc-api`) | 4 | **`otel-api`: transformer isolated** | 5.3 gated on KNOT 2 | 5.1 yes |
| 6 `ui` + `server` | 5 | ui out of runtime | client/server split | after 5.3 |
| 7 per-process composition | 6 | **the goal, realized + measured** | — | — |

**Start here:** Phase 0.3 (boundary lint ratchet) + Phase 1.1 (`ee` seam) — both land now, one gives the footprint win immediately, the other makes the whole migration self-enforcing.

---

## Appendix — grounding data (all measured 2026-07-21)

- Boot graph: ~8,500 modules / ~500 MB RSS per process (unbundled tsx over `src/`).
- Typecheck: app project 12,799 files / 1.58 GB; tests 14,118 / 1.8 GB.
- `event-sourcing → app-layer` back-edges: 65 total, 54 via pipelines.
- Heaviest boot packages (post-#6023 census): `zod` 252 mods, `@opentelemetry/otlp-transformer` 54/1.8 MB, `@langchain/core` 172 (via CopilotKit), `@ark-ui/react` 876 (frontend leak), `openai` 232, `stripe` 136 (SaaS-only), `@chakra-ui/react` 371 (frontend leak).
- `getApp()` DI seam exists; services reach each other via `getApp().{planProvider,traces,topicClustering,langy,emailSuppressions,…}`.
- Prisma: 92 models, connected graph, irreducible; split-generator gives ~zero win (do not repeat that investigation).
- Related memories: `type-analysis-findings`, `dev-memory-footprint`, `no-full-typecheck`, `vitest-ram-trap`.
