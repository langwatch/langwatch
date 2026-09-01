# Worker Eventing consumer cutover

Status: design frozen 2026-09-01, at branch `feat/strict-feature-layout-v0`
HEAD `b459add7cc`. Parity groundwork landed in `52d8defe3e`.

The question this answers: how does the deployed worker come to run the
packaged composition (`apps/worker`'s `WorkerProductionComposition`) as the
one consumer of `event-sourcing/jobs`, with the App keeping a working
producer surface on every role, no moment of zero or two consumers, and
without waiting for the Wave 2/3 service extraction.

## Grounding facts (verified at `b459add7cc`)

1. **The consumer is a construction-time side effect.**
   `createEventingGroupQueueFactory` (`packages/eventing/src/queues/groupQueueFactory.ts:57-68`)
   instantiates a `GroupQueueConsumer` and calls `.handle(...)` when a queue
   definition is created, iff `consumersEnabled`. The legacy worker starts
   consuming midway through `initializeWorkerApp()`, with an
   unroutable-reject/redeliver window until the last pipeline registers. Any
   new shape inherits (and need not improve) this window.
2. **The producer surface never needs consumers.** On the web role presets
   already runs `consumersEnabled: false` at both sites and the whole
   `registerAll()` return surface (presets.ts:2455-2477) works — `.send()`
   only needs the producer. A worker-role App with consumers off is
   byte-for-byte the web-role App that has run in production for months.
   This is the strongest safety property available and the design leans on it.
3. **One `StaticPipelineDefinition` on two `EventSourcing` instances in one
   process is proven viable** — the parity guard does exactly this.
4. **Cross-pipeline dispatch is location-independent.** Routing metadata is
   stamped from names at send time; a handler on the packaged consumer that
   dispatches through an App-es producer proxy enqueues identical bytes.
5. **The 77-collaborator wall is thinner than it looks.** The capability
   contracts are thin (`{ buildProcessing(): definition }` plus late-bound
   `connect()`); the collaborators never need to move — only the definitions
   they are already baked into need handing across.

## Rejected shapes

- **Adopting the presets-built EventSourcing into the packaged runtime**: the
  process cutover it buys already happened (`workers.ts` boots
  `WorkerExecutable` today); it adds an "adopted" mode only to delete it,
  plus a double-close hazard, and moves the registry not at all.
- **Strict producer inversion** (worker-role producers resolved from the
  packaged registration): forks the producer surface per role and creates a
  deferred-through-deferred boot knot, for no gain — fact 4 makes App-side
  producers exactly as correct.

## The chosen shape: registry handoff

Presets keeps `registerAll()` on every role, lines 2455-2477 verbatim; the
App es becomes producer-only on the worker role (the proven web
configuration). `PipelineRegistry` gains a production export seam — the
honest version of what the parity test does with spies. A new platform
composition root maps that export into `WorkerProductionCompositionOptions`
(no-op connects: `registerAll` already resolved the `Deferred`s against
App-es dispatchers) and boots `WorkerProductionComposition` with consumers
enabled — the first and only caller allowed to. `workers.ts` swaps
compositions; consumer ownership is a parameter of the one booted
composition, so a process can never have both.

Decision 9 is satisfied literally: the complete package-composed registry
mounts (26 installers in `orderedFeatureInstallers` order, 190 keys), and
one tested consumer switch happens. Wave 2/3 then proceeds behind the seam:
each service extraction replaces one synthesized capability with the feature
package's real one, parity guard green throughout — the cutover stops being
the last step of extraction and becomes the first.

## Process graphs

Before (today):

```
WEB ROLE (unchanged throughout)                WORKER ROLE (today)
─────────────────────────────                  ───────────────────
initializeWebApp()                             workers.ts
  presets builds EventSourcing "es"              └─ WorkerExecutable.boot
    consumersEnabled=false ── producer only           └─ LegacyWorkerExecutableComposition
  PipelineRegistry.registerAll() on es                    └─ AppBoot → initializeWorkerApp()
    26 pipelines registered (passive)                          presets builds es
  commands → simulations/suites/governance/…                     consumersEnabled=TRUE ◄── THE consumer
       │                                                       PipelineRegistry.registerAll() on es
       ▼ .send()                                                 26 pipelines + handlers + PM loops
  Redis: event-sourcing/jobs ◄─────────────────────────────────  GroupQueueConsumer claims jobs
                                                          └─ WorkerRuntime → startWorkers()
```

After (post switch commit):

```
WEB ROLE (identical to before)                 WORKER ROLE (after)
─────────────────────────────                  ───────────────────
initializeWebApp()                             workers.ts
  es: consumersEnabled=false                     └─ WorkerExecutable.boot
  registerAll() → producer surface                    └─ PackagedWorkerExecutableComposition
       │                                                  ├─ AppBoot → initializeWorkerApp({eventingConsumers:"external"})
       ▼ .send()                                          │    presets es: consumersEnabled=FALSE ── producer only
  Redis: event-sourcing/jobs ◄──────────────┐             │    registerAll() on es (passive; same lines
                                            │             │      2455-2477 resolve the same producer surface)
              consumed by ──────────────────┤             │    app.workerEventingHandoff = {definitions, ports, substrate}
                                            │             ├─ WorkerProductionComposition.create({
                                            │             │      eventing: {…App's own substrate objects,
                                            │             │                consumers: ON + replay marker},
                                            │             │      capabilities mapped from handoff (no-op connects),
                                            │             │      globalProjections: isSaaS-gated })
                                            │             │    WorkerApplication.start(): 26 installers →
                                            └─────────────│──── GroupQueueConsumer claims jobs ◄── THE consumer
                                                          └─ transport: startWorkers() (non-Eventing loops unchanged)
```

Two es instances exist in the worker process — one producing (App), one
producing+consuming (packaged) — sharing the same Prisma/ClickHouse/Redis
clients and the same `GroupQueueDependencies` object, so payload
offload/staging semantics are identical.

## Steps, in dependency order

Preparatory commits, each behaviour-neutral and landable independently:

- **P1 — make the packaged consumer enableable; close the replay-marker
  gap.** `worker-eventing.runtime.ts` replaces `consumersEnabled?: false`
  with a discriminant `consumers: { enabled: true; replayMarkerChecker? } |
  { enabled: false }` (default absent → false), threaded into both
  `EventingServerRuntime.create` and the inner `EventSourcing`. The
  replay-marker plumb is mandatory pre-switch: presets passes
  `RedisReplayMarkerChecker` and the checker acts on the consuming side.
- **P2 — `PipelineRegistry.exportWorkerCapabilities()`.** Route every
  `eventSourcing.register(<expr>)` through a private recorder; capture the
  trace installer options; expose `{ definition(name), trace,
  eventingMaintenance, governanceRuntime }` after `registerAll()`. Re-seat
  the parity guard on this seam instead of `vi.spyOn`.
- **P3 — presets names the consumer owner.**
  `eventingConsumers?: "app-owned" | "external"` (default app-owned);
  `appOwnsEventingConsumers = external not requested && roleRunsWorkers`;
  the two `consumersEnabled:` sites (≈2111, ≈2125) and the
  `topic.startBootSeeds()` gate (≈2528) move to it. Everything else keyed
  on `roleRunsWorkers` (scheduler, report handler, scenario pool,
  governance pull arming, system migrations) stays keyed on
  `roleRunsWorkers` — worker-process responsibilities, not consumers.
  Expose `app.workerEventingHandoff` (export seam + substrate + replay
  marker + topic deps + `isSaas` + `appOwnsEventingConsumers`).
- **P4 — the platform composition root**, built and tested, not yet booted:
  `runtime/worker/packaged-worker.capabilities.ts` (pure mapper, no-op
  connects, the scenario deferred-metrics job spec promoted to shared
  production code, `configureGlobalProjections` gated on the one
  `config.isSaas`) and `runtime/worker/packaged-worker.executable.adapter.ts`
  (boots with `eventingConsumers: "external"`, throws if the App reports
  app-owned consumers or ClickHouse/Redis absent, reuses
  `createLegacyWorkerPorts` for transport, drains packaged then App).
- **P5 — the pre-switch test suite** (below).

The one atomic switch commit: `workers.ts` selects
`PackagedWorkerExecutableComposition` by default with
`LANGWATCH_WORKER_COMPOSITION=legacy` as the escape hatch, plus the ledger
update. Cleanup one stable release later deletes the legacy composition and
the flag.

## Tests that must exist before the switch

1. Parity guard re-seated on `exportWorkerCapabilities()` + the production
   mapper (190 keys, mount order, `job-registry.json`).
2. Composition-root unit test: consumers-enabled reaches both sites, replay
   marker and retention threaded, 26 installers in order, start ordering.
3. Single-consumer invariants: `"external"` → both presets sites false and
   boot seeds skipped; packaged root throws on app-owned; defaults preserve
   today exactly (worker=on, web=off, all=on).
4. Cross-es dispatch integration test: one process, real Redis — App-shaped
   producer enqueues, packaged consumer processes, and a consumer-side
   handler's follow-up dispatch through an App-es proxy is consumed too.
5. No-double-resolve: mapping the handoff and installing every installer
   performs zero `Deferred.resolve` calls beyond `registerAll`'s own.
6. Governance-arming: with the packaged graph active and the App passive,
   the ingestion-pull wake schedule fires exactly once.

## Rollback

Fast: set `LANGWATCH_WORKER_COMPOSITION=legacy`, roll pods. Mixed fleets
are competing consumers with byte-identical registries — safe in either
direction because the parity guard pins identity; it must stay green as a
merge gate. Slow: revert the switch commit; every preparatory commit is
behaviour-neutral and stays. Queue durability means a crash-looping pod
loses no work.

## Risks

| Risk | Mechanism | Mitigation |
|---|---|---|
| Double-consume (in-process) | presets on + packaged on in one pod | Structurally impossible post-P3 (ownership is a parameter of the one booted composition); root throws on app-owned (test 3) |
| Double-consume (fleet) | rolling deploy mixes legacy and packaged pods | Ordinary competing consumption, safe only because registries are identical — the parity guard is the merge gate |
| Zero-consume | packaged root fails after App boot while presets no longer consumes | `WorkerExecutable` exits non-zero → restart; rollout must gate old-pod termination on new-pod readiness, and readiness must include queue-ready — verify the chart's worker probe before the switch |
| Producer breakage on web | P2/P3 touch presets/pipelineRegistry | Option-gated with defaults preserving today's exact expressions; 2455-2477 untouched |
| Unroutable boot window | consumer live from first registered queue | Identical to today's legacy boot; redelivery absorbs it |
| Double side effects | topic boot seeds, governance arming on both instances | Seed gate moves with the consumer (P3); passive App `ProcessRuntime` never loops; tests 3 and 6 |
| Deferred double-resolve | a synthesized capability with a real connect | No-op connects by contract; test 5 |
| Replay/retention drift | packaged es lacked `replayMarkerChecker` | P1 plumbs it; test 2 asserts it |
| SaaS global-projection mismatch | consumer without `global:*` handlers rejects billable jobs forever | Both sides derive from the one `config.isSaas`; `job-registry.json`'s `globalProjections` block keeps the guard honest |
