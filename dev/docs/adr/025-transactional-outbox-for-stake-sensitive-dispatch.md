# ADR-025: Transactional outbox for stake-sensitive reactor dispatch

**Date:** 2026-05-28 (revised 2026-06-01)

**Status:** Accepted

## Context

LangWatch reactors today dispatch side effects in-line: the matching handler (e.g. `alertTrigger.reactor`) calls `sendSlackWebhook` / `sendTriggerEmail` / `addToDataset` synchronously inside `handle()`. Failures are wrapped in `try/catch`, logged, and captured to PostHog — but the trigger UI shows nothing, there is no retry, no operator-visible "stuck" state, and no audit trail of past dispatches.

This is acceptable for **best-effort** reactors (UI broadcasts, fold sync, cache invalidations) where missing one invocation is a non-event. It is unacceptable for **stake-sensitive** reactors — those that produce customer-visible side effects (emails, Slack messages) or write to LangWatch-managed systems on the customer's behalf (dataset rows, annotation queue items) — where a missed dispatch is either a customer-trust violation or data loss.

Two distinct operational pains today:

1. **Silent dispatch failures.** A 4xx from Slack ends as a captured exception with no signal to anyone running the trigger. We discover it via support tickets.
2. **No retry semantics.** A transient SES 5xx kills a dispatch that should have retried in 30 seconds.

The reactor framework currently makes no distinction between these two reactor classes. The default is "best-effort with silent failure," which is the wrong default for half the reactors we run.

Beyond the substrate itself, three sub-decisions sit inside this one design and were originally written as separate ADRs (021/022/023/024); revision unification on 2026-06-01 collapsed them into this single document:

- How dispatch state and the historical match-claim ledger relate (the `TriggerSent` / `ReactorOutbox` two-tier split).
- What primitive owns dispatch scheduling and execution (`GroupQueue`, with one queue carrying multiple stages as a payload discriminator).
- How reactor authors opt in (`.withOutbox` on the pipeline builder, sibling to `.withReactor`).

## Decision

Introduce a **transactional outbox** as the durable substrate for stake-sensitive reactor dispatch — implemented as **a stage-discriminated payload rider on the main event-sourcing GroupQueue (the source of truth for scheduling and execution) plus a PG audit projection (the source of truth for history and operator visibility)**.

### The substrate

- Settle and cadence dispatch execution rides the **main event-sourcing queue** (`event-sourcing/jobs`). Outbox payloads carry a `stage` discriminator (`"settle" | "cadence"`); the queue's callbacks (`groupKey`, `process`, `processBatch`, `coalesceMaxBatch`, `deduplication`) peel the outbox case off first and delegate to the outbox dispatcher, falling through to the existing registry-based event-sourcing dispatch for everything else. Per-trigger FIFO via `groupKey`, delayed dispatch for cadence windows (`delay` + `processBatch` for coalescing), per-tenant fairness, lease/heartbeat, and retry-with-backoff all come from the queue. Reactors registered via `.withOutbox` use this path going forward.
- A PG table `ReactorOutbox` holds one row per dispatch, **maintained by a queue-side audit adapter** (`PgOutboxAuditAdapter`). The adapter receives every queue lifecycle event (`onEnqueue`, `onLeased`, `onDispatched`, `onFailed`, `onDead`) and writes the corresponding row state. Operators query PG for activity feeds, stuck-state alerts, retry buttons — never Redis.
- The **match** half of the reactor runs in-band on the main event-sourcing queue (inheriting `_originGuardedReactor`'s loop-prevention guards) and calls `outboxQueue.send(payload, …)` per match. The queue's dedup config absorbs replay.
- The **dispatch** half runs in the outbox queue's `process` callback. Failures throw `DispatchError` (ADR-027); the queue's retry semantics handle backoff, and the adapter mirrors each transition to PG.
- Best-effort reactors stay on `.withReactor` — no change to their execution model.

**The queue is the source of truth for dispatch execution.** **The PG row is the source of truth for dispatch audit.** Both must agree on every transition, which is why the adapter lives inside the GroupQueue rather than alongside it — every lifecycle event publishes through one hook that cannot be bypassed.

Replay safety comes from the queue's dedup config (`(reactorName, dedupKey)` collapses replayed enqueues onto the existing pending job) plus, for trigger reactors, `TriggerSent` as the cross-pipeline match claim (see "two-tier dedup" below).

### Two-tier dedup: `TriggerSent` vs `ReactorOutbox`

The trigger dispatch path answers two distinct questions:

1. **"Has this trigger matched this subject, ever?"** — the *match claim*. Stops the trace-processing reactor and the evaluation-processing reactor from both dispatching the same trigger when their pipelines race. Subject is `traceId` for trace/evaluation triggers, `customGraphId` for custom-graph alerts; `TriggerSent` stores the unused column as `NULL`. Today this is `TriggerSent` with `@@unique([triggerId, traceId])` and `createMany skipDuplicates` returning `count: 1` to the winner — adequate for trace triggers; Postgres treats `NULL` as distinct in unique constraints, so custom-graph alerts rely on the alert's `resolvedAt` lifecycle (one open row at a time) rather than a hard uniqueness constraint.
2. **"Has this match been dispatched? With what status, retry count, last error?"** — the *dispatch state*. Today this doesn't exist; dispatch is in-line and stateless. `ReactorOutbox` answers it.

These stay as **two separate tables** with distinct roles:

- `TriggerSent` is **domain** state, scoped to triggers, with the cross-pipeline race winner property baked in via the unique constraint. **Unchanged** by this ADR.
- `ReactorOutbox` is **framework** audit state, scoped per-reactor (the table will hold rows for `customerIoTraceSync` and future auditable reactors too), with the dispatch lifecycle columns operators query against (`status`, `attempts`, `lastError`, `nextAttemptAt`, `dispatchedAt`). Rows are maintained by the queue's audit adapter, not by application code. Row-per-match, with `@@unique([projectId, reactorName, dedupKey])` where:
  - Trace/evaluation triggers: `dedupKey = ${projectId}/${triggerId}:trace:${traceId}`.
  - Custom-graph alerts: `dedupKey = ${projectId}/${triggerId}:graph:${customGraphId}`.

  The `${projectId}/` prefix mirrors the `groupKey` convention (see queue section) and makes tenant scoping structural in the key itself. The `:trace:` / `:graph:` discriminator keeps the two subject types in separate namespaces so a future trigger type cannot collide.

Outbox **queue enqueue** is **gated on `TriggerSent` claim succeeding**: the reactor's match phase first calls `TriggerSent.claimSend`; only on a successful claim does it call `outboxQueue.send(...)`, which then writes the corresponding `ReactorOutbox` audit row via the adapter's `onEnqueue` hook.

### GroupQueue as the dispatch substrate

Outbox dispatch rides the existing main event-sourcing `GroupQueueProcessor` instance (`event-sourcing/jobs`). The runtime (`src/server/event-sourcing/outbox/setup.ts`) constructs the dispatcher + audit adapter and exposes them to `EventSourcing`'s queue-construction step, which adds a payload-discriminator branch to each of the queue's callbacks. There is no `langwatch:outbox` queue.

The queue carries **two outbox stages as a discriminated payload union**:

- `SettleStagePayload { stage: "settle", projectId, triggerId, traceId, … }` — per-(trigger, trace) Debounce Mode entry. The trace-readiness debounce from ADR-026 lives here. New events on the same (trigger, trace) collapse onto the existing pending job and reset the TTL. When the TTL elapses, the dispatcher re-reads the now-settled fold, runs filters, claims `TriggerSent`, and on match re-enqueues as `cadence`.
- `CadenceStagePayload { stage: "cadence", projectId, triggerId, match, … }` — per-trigger group, windowed delay snapped to the next wall-clock cadence boundary. The queue's `processBatch` + `coalesceMaxBatch` fold every cadence job for the same trigger landing in the same boundary into one digest invocation.

Per-stage queue behavior (dedup mode, delay, group key, coalescing) is driven by the payload's `stage` discriminator so one queue serves both timing primitives without merging them — the operator's `traceDebounceMs` and `notificationCadence` knobs (ADR-026) stay independently tunable.

**Per-trigger FIFO** is guaranteed by setting `groupKey = ${projectId}/${reactorName}:${triggerId}` (or, for non-trigger reactors, whatever stable identifier the reactor defines after the `${projectId}/` prefix). The `${projectId}/` prefix is mandatory: outbox payloads bypass `queueManager`'s automatic `${tenantId}/` wrapping (`queueManager` resolves prefixes through the registered job entry, and outbox payloads don't go through that registry), so the producer must include the prefix itself so `tenantIdFromGroupId` (see `src/server/observability/tenantRateTracker.ts`) can extract the tenant and per-tenant fairness via `TenantRateTracker` works.

**Cadence windows** are handled natively by setting `delay = scheduledFor - now()` on send. The queue dispatches the job when the delay elapses; no polling needed.

**Digest coalescing** is handled by the queue's `processBatch` + `coalesceMaxBatch` configuration: when the cadence window flushes for a trigger, the queue invokes the dispatcher with every same-`groupKey` job currently ready, in one batch. The dispatcher renders one digest from the array of payloads. No application-level `SELECT … FOR UPDATE` against PG.

**Dedup is stage-aware.** The settle stage uses Debounce Mode (`makeId: settleDedupId, extend: true, replace: true`) — every new event on the same (projectId, triggerId, traceId) collapses onto the pending job and resets the TTL. The cadence stage uses a different `makeId` so digest members don't dedup against each other; the cadence window stays anchored to the boundary, not to the first match.

### `.withOutbox` pipeline-builder primitive

Add `.withOutbox(projectionName, reactorName, definition)` to `StaticPipelineBuilder` as a sibling to `.withReactor`. The choice between the two is required at registration time. There is no flag, no default that "promotes" a reactor between modes.

```ts
// Existing — extended with isReplay
type ReactorContext<FoldState> = {
  // ...existing fields...
  isReplay: boolean;   // true when the event was produced by a stream replay
};

type ReactorDefinition<Event, FoldState> = {
  handle: (event: Event, context: ReactorContext<FoldState>, deps: Deps) => Promise<void>;
  options?: { makeJobId, ttl, delay };
};

// New
type OutboxReactorDefinition<Event, FoldState> = {
  match: (event: Event, context: ReactorContext<FoldState>, deps: Deps) => Promise<OutboxEntry[] | null>;
  dispatch: (payloads: unknown[], ctx: DispatchContext, deps: Deps) => Promise<void>;
  groupKey: (entry: OutboxEntry) => string;
  cadenceWindowMs: (entry: OutboxEntry) => number;
  retryPolicy?: { maxAttempts: number; backoffMs: (attempt: number) => number };
};
```

`match` runs in the event-sourcing queue with the existing `_originGuardedReactor` guards. It returns the outbox entries to persist; it does NOT perform side effects.

**Replay safety for `.withOutbox`**: the framework wrapper short-circuits `match` when `context.isReplay === true` — no outbox row is inserted, no wakeup is scheduled. Without this, replaying historical events (after the outbox row's 30/90-day retention has pruned the original dispatch record) would insert fresh `queued` rows and re-fire customer-visible side effects.

`dispatch` runs in the outbox dispatch worker. It receives the batched payloads for a triggered wakeup, performs the actual side effect, and throws `DispatchError` (ADR-027) on failure.

**Folder layout** (framework code; domain code stays adjacent to other reactors):

```text
src/server/event-sourcing/
  outbox/                              -- framework primitive
    outbox.types.ts                   -- OutboxReactorDefinition, OutboxEntry
    dispatchError.ts                  -- DispatchError class (see ADR-027)
    setup.ts                          -- GroupQueue registration + processor
    outbox.service.ts                 -- service shim for tests and the audit projection
    outbox.repository.ts              -- PG repository abstraction
    outbox.prisma.repository.ts       -- Prisma implementation
    pgAuditAdapter.ts                 -- QueueAuditAdapter implementation
    __tests__/
  pipeline/
    staticBuilder.ts                  -- modified to add .withOutbox
  pipelines/<pipeline>/reactors/
    alertTrigger.reactor.ts           -- domain-specific match + dispatch
```

The framework wrapper invoked by `.withOutbox` is responsible for:

1. Wrapping `match` in `_originGuardedReactor` guards.
2. Gating queue enqueue on `TriggerSent.claimSend` (or equivalent reactor-defined claim).
3. Calling `outboxDispatchQueue.send(payload, { delay: cadenceWindowMs, deduplication: { makeId: dedupKey } })`.

The queue's `PgOutboxAuditAdapter` writes the `ReactorOutbox` row via its `onEnqueue` hook. There is **no** separate `createMany skipDuplicates` step in the wrapper — the queue's dedup config is the replay-safety mechanism, and the adapter mirrors the resulting transition to PG.

The reactor author writes `match` and `dispatch`; everything else is provided.

### Revision (2026-06-02) — outbox rides the main event-sourcing queue

The 2026-06-01 revision collapsed two outbox queues into one (settle + cadence on a stage-discriminated payload). 2026-06-02 took the next step: collapse that one outbox queue onto the **main event-sourcing queue** (`event-sourcing/jobs`) instead of standing up a sibling `langwatch:outbox` instance.

Outbox payloads are still stage-discriminated (`stage: "settle" | "cadence"`); the runtime composition just looks different. `buildOutboxRuntime(...)` returns `{ dispatcher, auditAdapter, enqueueSettle, attachQueue }` — no `queue` field. `EventSourcing`'s `createGlobalQueue()` reads the outbox runtime off its options, adds a "is this payload settle or cadence?" branch to each of the queue's callbacks (`groupKey`, `process`, `processBatch`, `coalesceMaxBatch`, `deduplication`), and wires the runtime's audit adapter onto the queue's `auditAdapter` slot. The adapter already gates internally on `isSettle || isCadence`, so non-outbox queue events no-op cheaply at the adapter level.

Wins:
- One Redis prefix, one set of Grafana panels, one crash-recovery story. The second queue's operational tooling (metrics, alarms, deploy gates) goes away.
- No second queue to keep wired through the composition root — `EventSourcing` is the only thing that knows how to make a `GroupQueueProcessor`.
- The audit adapter's existing payload gating did the conceptual work already; the change is structural, not semantic.

Trade-off (captured here so the next person feels it):
- Trigger dispatches and span projections now share the per-tenant fairness budget. A notification storm can nibble at the projection slot budget for the same tenant, and vice versa. Bounded by `TenantRateTracker` so neither side starves catastrophically, but it's a regression in isolation guarantees vs the two-queue split. If we ever want to scale them independently (different Redis instances, dedicated worker pools), we lose the ability to do that cheaply.

### Revision (2026-06-01) — what changed from the original draft

Originally this design was four ADRs (021/022/023/024) with **PG as the source of truth for both scheduling and audit** — `OutboxRepository.leaseGroup` / `leaseNext` / `markDispatched` polled and mutated PG rows directly, and a separate "wakeup queue" only signaled when rows were ready. That meant we re-implemented scheduling (delays, retries, leasing, FIFO) on top of PG when the in-house `GroupQueue` already had every one of those primitives.

The revised design (above) keeps the same external behavior — durable retry, operator visibility, replay safety — but consolidates execution on the GroupQueue and lets PG go back to being a write-mostly audit log. Less code, one queue primitive instead of two, and the dual-state-sync hazard goes away because the adapter is the only writer of `ReactorOutbox` from runtime.

**Phased rollout.** The Phase-0 outbox infrastructure (`OutboxDrainer`, `OutboxRepository.leaseNext` / `markDispatched` / `markRetry` / `recoverExpiredLeases`, the `wakeupQueue` carrying wakeup-only payloads) was deployed alongside the original draft. Removing it now would risk leaving any in-flight Phase-0 dispatch behind. So the queue-driven path **coexists** with the Phase-0 path:

- New reactors register via the queue-driven path with `auditAdapter` wired.
- Existing Phase-0 code stays in place; `OutboxDrainer` becomes dead code once every reactor that used to register with it has migrated.
- A follow-up cleanup PR (out of scope here) drops the Phase-0 drainer + lease* methods + the `leasedUntil` / `nextAttemptAt` columns from `ReactorOutbox`.

## Rationale

### Rejected: event-sourced dispatch

Emit a `TriggerDispatchScheduled` event from the matching reactor, have a separate reactor consume it and perform the dispatch, emit `TriggerDispatched` / `TriggerDispatchFailed` events as outcomes. This is the "canonical" event-sourced shape and was the first design considered.

Rejected because:

- **Replay danger.** A replay of the trace event stream would re-emit dispatch events, which would re-fire customer emails. Loop-prevention guards in `_originGuardedReactor` don't help — by the time the dispatch reactor sees the event, it's too late to know it came from a replay.
- **Too many hops.** Six pipeline stops (`span_received → projection → alertTrigger → emit → dispatch reactor → dispatch → emit outcome`) for what is fundamentally "send this email."
- **Head-of-line blocking.** Dispatch failures would back up the trace-processing event stream, which the fold projections also depend on.

### Rejected: extend in-line dispatch with hand-rolled retry

Each reactor adds its own retry loop, its own error categorization, its own status tracking column. Rejected because every reactor would re-implement the same wheel slightly differently, there'd be no shared operator surface, and the retention/cleanup story would diverge per-reactor.

### Why outbox-as-table (audit projection, not source of truth)

A PG table gives us durability (outlives Redis), queryability (operator UI reads rows directly), and the structured `status` enum operator dashboards key off of. The state-machine semantics of a table — atomic UPDATEs, explicit transitions — match the reasoning model better than an append-only event log when the question is "is this dispatch done or not?"

What it does **not** need to do — and what the revised design removes — is own the scheduling primitive. The GroupQueue already has dedup, per-group FIFO, delay, retry with backoff, lease/heartbeat, and per-tenant fairness. The wins from promoting the queue to source-of-truth: ~40% less framework code, no `leaseGroup` race against the queue, and no opportunity for the two views to drift.

### Why the audit adapter lives inside the GroupQueue

The adapter mirrors **every** queue lifecycle event into PG. If it lived as a sibling consumer there'd be windows where the queue has dispatched a job but PG still says `enqueued` — exactly the dual-state-sync hazard the revision is supposed to remove. Embedding the adapter as a `QueueAuditAdapter?` field on `GroupQueueProcessor` means every lifecycle hook fires through it before the queue considers the transition complete.

Adapter writes are still best-effort relative to dispatch: a PG outage logs and metrics but does not block Redis-side execution (the queue keeps running, the adapter retries, the projection catches up). Operator dashboards alert on adapter-lag metrics when reconciliation falls behind.

### Why not merge `TriggerSent` and `ReactorOutbox` into one table

- `TriggerSent` is scoped to triggers. `ReactorOutbox` is the substrate for all future stake-sensitive reactors — `customerIoTraceSync`, anything else writing to an external system. Merging would conflate domain state with framework state, and the unique-constraint semantics differ (`TriggerSent` is cross-reactor by design; `ReactorOutbox` is per-reactor by design).
- A merged table would need the cross-reactor uniqueness of `TriggerSent` and the per-reactor lifecycle of `ReactorOutbox` in one schema. Possible but awkward, and it forces the framework's outbox to know about trigger-specific column semantics.

### Why row-per-match over row-per-window

- **PG contention.** Row-per-window with JSONB append serializes 1000 concurrent matches on one row. Row-per-match has no contention — each match inserts a fresh row, and `@@unique([reactorName, dedupKey])` makes the insert idempotent for replays.
- **Replay safety.** With row-per-match, a replay of the matching event re-attempts `createMany skipDuplicates` on the same `dedupKey` → no-op. With row-per-window, replay attempts an `INSERT ... ON CONFLICT DO UPDATE` that *appends* — possibly double-counting the trace.
- **Mirrors `TriggerSent`.** Both tables have the same per-match grain. Operator queries can join them on `(triggerId, traceId)` or `(triggerId, customGraphId)`.
- **Cost of more rows is negligible.** Outbox rows live ~minutes (until the worker drains the digest), then transition to `dispatched` and live ~30 days for audit, then prune.

### Why outbox insert is gated on `TriggerSent` claim

If we insert outbox rows unconditionally, an out-of-order replay could insert a new `queued` outbox row for a `(triggerId, subjectId)` whose digest has already been dispatched. The drainer would happily re-notify. Gating insertion on the `TriggerSent` claim means: if a match has already been claimed by either pipeline, no new outbox row is created. `TriggerSent` is the durable "we've already considered this match" anchor; `ReactorOutbox` is the durable "what's the dispatch's life-cycle state" anchor.

### Why GroupQueue and not BullMQ

LangWatch removed BullMQ in PR #4114 ("Skynet BullMQ removal"). GroupQueue is the canonical async-work substrate. Reintroducing BullMQ for the outbox would split the operational story across two queue systems (Redis configuration, metrics, monitoring, crash recovery, ops runbooks) for no benefit. Every capability we'd want from BullMQ is in GroupQueue.

### Why GroupQueue and not a polling drainer

A polling drainer (`setInterval(30_000)` + `FOR UPDATE SKIP LOCKED`) would work — but it re-implements scheduling (delays), fairness (round-robin per tenant), and ordering (FIFO per trigger) that GroupQueue already provides natively. It also introduces a new metric/alarm surface in parallel with the existing one. The polling approach was the initial sketch; the GroupQueue capabilities discovered during code review obsoleted it.

### Why one queue with stage-discriminated payloads, not two queues

The earlier draft used two separate queues for settle and cadence. They were unified on 2026-06-01 because the maintenance surface (Redis prefixes, metrics, deploy gates, audit adapter wiring) doubles with no behavior gain — a `stage:` field in the payload achieves the same separation with one queue. `DeduplicationConfig.makeId` is a function of payload, so the same queue can return Debounce Mode keys for settle payloads and per-job keys for cadence payloads.

### Why full-payload queue jobs (revised)

The original design used **wakeup-only payloads** — the queue stored ~50 bytes per pending trigger and the dispatcher re-read the variable-size payload from PG. The 2026-06-01 revision flipped that: the queue carries the full payload, PG holds an audit projection.

- **One source of truth for scheduling.** Wakeup-only meant the queue knew "something is ready" and PG knew "what." Two sources of truth always disagree under failure.
- **Coalescing is in the queue layer where the locking already lives.** `processBatch` + `coalesceMaxBatch` give us digest grouping for free.
- **Queue memory is not the bottleneck.** Payloads of ~1 KB × low thousands of concurrent jobs is well within Redis envelope.

### Why a distinct `.withOutbox` API, not a flag on `.withReactor`

The two reactor classes have genuinely different shapes:

- `.withReactor` reactors do everything in one handler; they have no concept of "match phase" vs "dispatch phase."
- `.withOutbox` reactors must split because the match runs synchronously with the event stream (for loop-prevention guards) and the dispatch runs asynchronously (for retry, cadence, durability).

A single `.withReactor(..., { durable: true })` flag would force the API to accept both shapes through one entry point, awkwardly. A separate builder method makes the intent explicit and the type errors helpful when an author tries to do the wrong thing.

## Consequences

- **`ReactorOutbox` table in PG** — written exclusively by the adapter on the queue-driven path, read by operator surfaces. Bounded size at steady state (one row per pending or recently-completed dispatch, 30-day retention for `dispatched` rows, 90 days for `dead`). The end-state schema (no `leasedUntil`, `scheduledAt` in place of `nextAttemptAt`) is finalised in the follow-up Phase-0 cleanup PR, not this one.
- **New framework primitive:** `.withOutbox` on `StaticPipelineBuilder`, framework code under `src/server/event-sourcing/outbox/`.
- **New worker infrastructure:** a dedicated `outboxDispatchQueue` whose `process` callback dispatches and whose `auditAdapter` writes audit rows. Coexists with the Phase-0 wakeup queue + drainer; new reactors use the new path.
- **`QueueAuditAdapter` interface** on `GroupQueueProcessor` — a reusable hook that any queue can opt into for PG-backed audit. The `PgOutboxAuditAdapter` is the first implementation; future queues (e.g., a future stake-sensitive command queue) can wire their own.
- **Phase-0 outbox primitives (`OutboxDrainer`, `OutboxRepository.leaseNext` / `markDispatched` / `markRetry` / `recoverExpiredLeases`, `wakeupQueue`) are deprecated but still present.** Removed in a follow-up cleanup PR once no reactor is registered on them.
- **Two reactor classes now exist** in the system: best-effort (`.withReactor`) and stake-sensitive (`.withOutbox`). Authors and reviewers must choose at definition time. The default for new reactors should be `.withReactor` unless the side effect is auditable.
- **Operator surfaces** (activity tab, retry buttons, Grafana alarms on stuck-queue depth) become possible and necessary. Without them the outbox is just an extra hop. ADR-026 places them on the settings page.
- **`evaluationTrigger.reactor` stays on `.withReactor`.** It dispatches commands (event-sourced, in-band), not side effects.
- **The per-subject dedupKey is trace-path-only by design.** Aggregate-driven triggers — anything that fires on "metric crossed threshold over window" without a single owning row — don't have such a subject. When those land the natural dedupKey is `${projectId}/${triggerId}:${groupByLabelsHash}:${windowBucket}`, not per-subject. That's a new namespace in the same constraint, not a schema change.
- **Customer-supplied destinations are out of scope for v1, but the `dispatch` handler is endpoint-agnostic by design.** The moment a customer-defined webhook URL lands as a trigger destination, the framework needs SSRF blocking, HMAC request signing, payload size caps, per-destination secret encryption at rest. These are framework concerns — every future customer-webhook-like dispatch should share one outbound utility rather than each `dispatch` reinventing them.
- **Silencing has no integration point yet.** Notify-side mute ("stop pinging me for an hour, prod is degraded") belongs between match and dispatch — not inside the outbox state machine itself, not inside the dispatch handler. Today's pipeline has no such hook. Out of scope here.
- **Match + delivery are currently bundled on the `Trigger` row.** The natural future split is a separate `NotificationPolicy` row that holds delivery config, leaving `Trigger` as the match definition. This PR doesn't make that split; capturing it here so the trade-off is visible the next time the schema is touched.
- **Redis outage halts new dispatches.** Audit rows do not accumulate; the prior "PG keeps a backlog" property goes away with full-payload queue jobs. The compensation is that Redis outages are short and the queue's recovery semantics handle resume cleanly; long outages page operators via the audit-lag metric.
- **PG outage degrades the audit projection but does not block dispatch.** The queue keeps running; the `PgOutboxAuditAdapter` retries adapter writes and the projection eventually catches up.

## References

- ADR-007 — Event sourcing architecture (the framework this extends)
- [ADR-026](./023-per-trigger-dispatch-timing.md) — Per-trigger cadence + trace-readiness debounce (timing knobs that ride this substrate)
- [ADR-024](./024-liquid-templates-for-trigger-notifications.md) — Liquid templates (what `dispatch` renders for notify reactors)
- [ADR-027](./025-typed-dispatcherror-contract.md) — `DispatchError` contract dispatch handlers throw
- [ADR-026](./026-automation-operator-surfaces.md) — Authoring drawer + dispatch-health view that operators see
- [ADR-014 (Skynet BullMQ removal)](./014-skynet-bullmq-removal.md) — why we're not reintroducing it
- `src/server/event-sourcing/queues/groupQueue/` — the queue implementation
- `src/server/event-sourcing/queues/queue.types.ts` — `EventSourcedQueueDefinition`, `DeduplicationConfig`
- PR #4221 — `_originGuardedReactor` loop prevention this builds on
- PR #3528 — current in-line dispatch (the baseline this replaces for stake-sensitive reactors)
