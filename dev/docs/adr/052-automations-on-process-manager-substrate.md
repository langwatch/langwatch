# ADR-052: Automations dispatch on the process-manager substrate

**Date:** 2026-07-17

**Status:** Accepted

**Supersedes:** ADR-030's `ReactorOutbox` transactional-outbox mechanism and
the `.withOutbox` pipeline primitive. ADR-026/027 (settle debounce +
per-trigger cadence), ADR-031 (email abuse caps), ADR-035 (persist class),
ADR-036/041 (templates), ADR-040 (webhook channel) and ADR-034 Phase 5/6
(graph alerts) **behavioral contracts remain in force** — this ADR changes the
transport those behaviors ride, not the behaviors.

## Context

Automations (trace-match notifications, persist actions, and custom-graph
threshold alerts) were the first domain to need durable, retryable,
at-least-once side-effect dispatch out of the event-sourcing pipelines. They
got it via a bespoke stack that predates the generic substrate ADR-049
introduced:

- `.withOutbox(projection, name, reactor)` — a fold-attached reactor variant
  whose `decide()` returns enqueue requests;
- settle/cadence/graphEval stage payloads riding the **main event-sourcing
  GroupQueue** (Redis) with Debounce Mode as the timing mechanism;
- `ReactorOutbox` — a Postgres table maintained by a queue *audit adapter*
  (not the retry mechanism; retries came from GroupQueue redelivery);
- a global 30-second `OutboxHeartbeatScheduler` with a Redis leader lock for
  the graph-alert absence/resolve sweep.

ADR-049 then built the generic process-manager substrate for Langy — a pure
`ProcessDefinition.evolve()` over per-`(processName, projectId, processKey)`
state, a transactional inbox, `ProcessManagerOutbox` intents with lease/retry
dispatch, event-only subscribers, and (with ADR-051) durable `nextWakeAt`
timers via `ProcessWakeWorker`. Keeping two outbox mechanisms alive means two
retry doctrines, two idempotency schemes, and two operator surfaces for the
same concept.

## Decision

Automations become the third domain on the ADR-049 substrate. The legacy
outbox stack (`event-sourcing/outbox/*`, `.withOutbox`, the `ReactorOutbox`
table, the heartbeat scheduler) is **deleted**, not deprecated.

```text
trace / evaluation pipeline event (committed, via GroupQueue)
      │
      ├──► alert-trigger match subscriber ──► triggerSettlement process
      │        (loads fold for origin guards,        │ state: pending matches,
      │         loads active triggers, matches)      │ per-trace settleDueAt,
      │                                              │ nextWakeAt = digest due
      │                                              ▼ on wake
      │                                     ProcessManagerOutbox intents
      │                                       notify-digest:<boundary>
      │                                       persist-match:<traceId>
      │                                              │ lease/retry worker
      │                                              ▼
      │                                     dispatch handlers (unchanged
      │                                     behavior: confirm filters at
      │                                     settled fold, TriggerSent dedup,
      │                                     email caps, render, send / persist)
      │
      └──► graph-trigger activity subscriber ──► evaluateGraphTrigger
               (5s dedup per project)               (direct; own TriggerSent
                                                    idempotency, ADR-034)

ProcessWakeWorker (30s) ──► graphAlertSweep singleton process
                                 │ wake → sweep:<ts> intent
                                 ▼
                        heartbeat sweep handler (same candidate discovery +
                        recency probe as before) → evaluateGraphTrigger
```

### 1. Match detection moves to event subscribers

The four `.withOutbox` reactors (`alertTriggerNotifyOutbox`, `alertTrigger`,
and their evaluation-pipeline twins) collapse into two event subscribers —
one per pipeline. A subscriber receives the committed event only, so the
origin guards that read fold state (`trace age`, `blockedByGuardrail`,
`langwatch.origin`) now **load the traceSummary fold from its store**. The
subscriber runs with a short delay and per-trace debounce (the same 30s
window the reactor jobs had), by which time the fold has converged; the
dispatch handler re-confirms every match against the settled fold anyway, so
a racing read can only produce a false candidate that dispatch drops — never
a wrong notification.

The graph-alert real-time path needs no process state at all: its subscriber
collapses event bursts with a 5-second non-extending dedup window per project
and calls the shared `evaluateGraphTrigger` directly (which owns its
`TriggerSent` open/resolve idempotency). GroupQueue redelivery is its retry,
exactly as before.

### 2. Settle + cadence become process state and a durable timer

One `triggerSettlement` process per `(projectId, triggerId)` replaces the
settle/cadence queue stages. The subscriber feeds one envelope per matched
`(trigger, trace)` — envelope `eventId` is `${event.id}:${triggerId}` because
the inbox consumes each `sourceEventId` once per `(processName, projectId)`.
The envelope carries the trigger's *timing config snapshot*
(`actionClass`, `action`, `traceDebounceMs`, `notificationCadence`) so
`evolve` stays pure:

- on match: `pendingMatches[traceId].settleDueAt = occurredAt +
  traceDebounceMs` (a re-match extends it — the settle debounce);
  `dispatchDueAt = computeScheduledFor(action, cadence, settleDueAt)` (the
  ADR-026 wall-clock boundary snap); `nextWakeAt = min(dispatchDueAt)`.
- on wake: drain matches whose `dispatchDueAt` has passed into **one**
  `notify-digest:<boundary>` intent (the cadence digest) or per-trace
  `persist-match:<traceId>` intents (persist never digests, and per-trace
  message keys retry independently); re-arm `nextWakeAt` for the remainder.

Pending state is bounded (`MAX_PENDING_MATCHES`, overflow drops oldest with a
logged count) so a match storm cannot grow a state row without limit.

### 3. Dispatch handlers keep the behavioral contracts byte-for-byte

The `ProcessManagerOutbox` intent handlers are the old dispatcher bodies with
the transport peeled off:

- **notify-digest**: re-load trigger (gone/deactivated → drop), re-confirm
  each trace against the settled fold (ADR-043 `filterQuery` or legacy
  structured filters), in-batch + `TriggerSent` cross-batch dedup, ADR-031
  suppression + hourly/daily caps (cap slots keyed by the dispatch digest so
  outbox retries never double-burn), ADR-036/041 template render or legacy
  senders, ADR-040 webhook delivery with its `X-LangWatch-Event-Id`,
  claim-after-send, `updateLastRunAt` last. Terminal `DispatchError`s and
  cap/suppression drops return normally (dispatched, logged); retryable
  errors throw so the outbox retries with backoff (maxAttempts 8, parity with
  the legacy rows).
- **persist-match**: settle confirm + `dispatchTriggerAction` (dataset /
  annotation queue) + claim-after-dispatch, one trace per message.

`emailHourlyCap`, `dispatchError`, `triggerActionDispatch`, and
`graphAlertActionDispatch` move under `app-layer/triggers/dispatch/` and
`server/triggers/` — consumers import the new locations directly (no
re-exports).

### 4. The heartbeat becomes a singleton sweep process

The graph-alert absence/resolve sweep keeps its **global** shape — its
candidate set is derived from live Postgres (`isNoDataPredicate` triggers,
open `TriggerSent`) plus a ClickHouse recency probe, not from per-trigger
state — so it maps to one `graphAlertSweep` process (sentinel
`projectId = "__global__"`, `processKey = "graphTriggerHeartbeat"`) whose
`evolve` re-arms `nextWakeAt = +30s` on every wake and emits one
`sweep:<scheduledFor>` intent. The handler runs the same candidate discovery
and per-project isolation as the old `decideGraphTriggerHeartbeat`, then
calls `evaluateGraphTrigger` per surviving candidate. `ProcessWakeWorker`'s
revision fencing replaces the Redis leader lock — racing workers stand down
on `staleWake`. The worker boot seeds the singleton with a date-keyed
bootstrap envelope (idempotent via the process inbox), so a wiped instance
table self-heals within a day and a healthy one no-ops.

### 5. Deletion, not migration

`ReactorOutbox` has zero readers outside the machinery itself, so the table
is dropped by migration and the audit role is taken over by
`ProcessManagerOutbox` rows (status/attempts/trace carrier). Render
diagnostics stamping (ADR-036/037 operator surface) had no consumer and is
dropped with the audit adapter; re-adding it is a projection concern if an
operator surface ever materializes.

In-flight legacy settle/cadence/graphEval GroupQueue jobs at deploy time are
acknowledged and dropped by a tombstone guard in the event router (removable
after one release). The loss window is minutes of pending notifications at
cutover — the same class of loss a Redis restart already implied for these
stages.

## Rationale / Trade-offs

- **One outbox doctrine.** Alert dispatch and process effects now share one
  idempotency scheme (deterministic message keys), one retry ladder, one
  lease protocol, and one operator query surface.
- **Genuine transactionality.** The legacy stack's "transactional outbox" was
  a queue with a Postgres audit shadow; a Redis loss dropped pending
  settles. Now the pending matches and the dispatch intents are Postgres
  rows committed atomically with process state.
- **Purity where it pays.** Debounce/cadence timing is now a pure function of
  envelope timestamps — unit-testable without queue simulation.
- **Costs.** Matched trigger events now cost a Postgres commit each (bounded
  by match volume, which alert design keeps exceptional — and the legacy
  audit adapter already wrote a Postgres row per settle enqueue). The sweep
  singleton commits a revision bump every 30s (one row, cluster-wide). Wake
  granularity is the wake worker's 5s poll, so digest boundaries land up to
  ~5s late; the legacy delayed-job path had equivalent jitter.
- **Config snapshots.** `evolve` computes timing from the config captured at
  match time; a cadence change applies to matches that arrive after it, not
  to already-pending ones. The legacy queue had the same property (delay
  computed at settle time).

## Consequences

- `event-sourcing/outbox/` (dispatcher, setup, payload, audit adapter, email
  caps, heartbeat registry/scheduler, reactor adapter, enqueue fan-out) is
  deleted; `.withOutbox` and `OutboxReactorDefinition` leave the pipeline
  builder; `EventSourcing` loses the outbox constructor option, payload
  routing, and audit-adapter wiring.
- The `ReactorOutbox` model + `ReactorOutboxStatus` enum are dropped.
- Automations continue to require the workers deployment (now for the process
  outbox/wake workers rather than the queue drainer) — the ADR-034 posture
  from the graph-alert cron removal is unchanged.
- The webhook channel (ADR-040) dispatches through the new digest handler;
  its provider config, SSRF fence, delivery log, and retry classification are
  unchanged.

## References

- Behavioral spec: [`specs/automations/process-manager-dispatch.feature`](../../../specs/automations/process-manager-dispatch.feature)
- Substrate: ADR-049 (process manager, subscribers, process outbox), ADR-051
  (durable wakes / `ProcessWakeWorker`)
- Contracts preserved: ADR-026/027 (timing), ADR-031 (spam prevention),
  ADR-034 (graph alerts), ADR-035 (persist class), ADR-036/041 (templates),
  ADR-040 (webhook channel), ADR-043 (facet filters)
