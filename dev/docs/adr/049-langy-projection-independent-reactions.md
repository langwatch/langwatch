# ADR-049: Langy pilots Postgres operational state and projection-independent reactions

**Date:** 2026-07-15

**Status:** Accepted

**Supersedes:** ADR-046's ClickHouse operational-projection and
projection-bound reaction decisions. ADR-046's ClickHouse event-log choice,
event vocabulary, and durable/ephemeral split remain in force.

## Context

Before this decision, Langy's durable events landed in the ClickHouse
`event_log`, its conversation and turn folds were also stored in ClickHouse,
and all four Langy reactors were attached to the conversation fold. That design
created two problems for an interactive product:

- operational reads wait on an eventually consistent analytical database; and
- workflow decisions receive a captured read projection as if it were durable
  process state.

The old delayed liveness reactor demonstrated the second problem directly. Its
captured fold was stale by the time the timer fired, so it had to re-read
ClickHouse before deciding whether the turn had completed. The old fold hot path
needed a Redis write-through cache because the ClickHouse write did not wait for
visibility.

Langy is an operational, low-volume, latency-sensitive workflow. ClickHouse is
excellent for analysing Langy usage, latency, cost, models, tools, and outcomes,
but it should not answer "may this user continue this conversation?" or "is
this turn still running?" Redis remains appropriate for live tokens,
heartbeats, and short-lived worker handoffs, but not for durable conversation or
workflow state.

Langy is still gated, conversations are FIFO per aggregate, and the domain is
small enough to validate a new boundary before applying it to evaluations or
simulations.

## Decision

The existing ClickHouse `event_log` remains the single source of truth for
Langy events. Postgres will hold rebuildable, low-latency operational
projections and process-manager state. ClickHouse will also hold Langy's
analytical projections, but its conversation/message projections will leave
the operational read path.

```text
command handler
      │
      ▼
ClickHouse event_log ─────── durable event authority / replay source
      │ after successful append
      ▼
GroupQueue event envelope ── normal hot path; no event-log read
      ├──► Postgres conversation / turn / message fold
      ├──► conversation process manager
      │       └── Postgres process outbox ──► worker / command / title effect
      ├──► event-only subscribers
      └──► ClickHouse analytics events
```

### 1. ClickHouse owns events; the queue feeds the Postgres fold

The current store-before-dispatch contract remains:

1. a command handler emits a deterministic, uniquely identified event;
2. the full event is durably appended to ClickHouse `event_log`;
3. only after that succeeds, the event envelope is staged in GroupQueue; and
4. per-aggregate FIFO consumers apply the queued event to Postgres operational
   projections and process state.

Normal consumers use the event already present in the queue envelope. They do
not query ClickHouse to fetch it. ClickHouse is read only for explicit replay,
bootstrap, or repair of an event-log-to-queue dispatch gap.

The queue is transport, not a second source of truth. If staging fails after
the event append, the command's event is still accepted. A repair/re-drive path
must scan the canonical ClickHouse log and stage the same deterministic queue
job. Queue retry and Postgres event-id/cursor guards make applying that event
again a no-op.

The initial Postgres data model is deliberately Langy-sized:

| Table                             | Role                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `LangyConversationProjection`     | Slim operational conversation state and ownership                    |
| `LangyConversationTurnProjection` | Operational turn status, plan/tool lifecycle, and final render state |
| `LangyMessageProjection`          | Ordered conversation history                                         |

These tables do not copy the event log. A state-projection row carries the
canonical `(AcceptedAt, EventId)` cursor. GroupQueue serializes work for that
projection key; the executor loads once, skips an already-applied cursor, runs
the type-aware reducer, and upserts once. The cursor is part of the same row, so
there is no separate projection inbox, Redis cache, or database transaction
around the load/apply/store cycle. Message rows use deterministic identities and
unique keys. Conversation, turn, and message projections converge independently;
we do not claim a cross-table transaction. Replay deterministically rebuilds
the same operational rows from the canonical event log.

Because the event log and operational projection are in different databases,
they are deliberately not atomic. We must not claim transactional
read-after-write. The expected path is low-millisecond convergence through the
queue. A projection-completed freshness signal is emitted only after the
Postgres fold commits. A command that requires a hard consistency boundary must
wait for the relevant Postgres cursor or return an explicit retryable not-ready
result; it must not silently decide from a known-stale projection.

We will keep Langy's event vocabulary, schemas, deterministic idempotency keys,
and pure fold functions. We will not force the high-volume trace event store
onto Postgres as part of this pilot.

### 2. ClickHouse holds the event log and analytics, not operational reads

The first analytical projection consumes the same queued event and writes one
content-free `langy_analytics_events` row per source event. Future ClickHouse
views or scheduled aggregates may derive:

- turn count, success/failure, and retry rate;
- time to first token and total turn duration;
- tool use, tool duration, and tool failures;
- model, token, and cost usage;
- worker capacity/restart/handoff outcomes; and
- feature adoption and conversation activity by tenant/time bucket.

These analytical projections are pure event-to-row writes. They do not read an
old projection before writing, and they have no Redis cache. Every row carries
the source `EventId` and all dimensions/measures available on that event. Where
an end-to-start calculation matters, prefer recording the duration on the
terminal event; otherwise ClickHouse can derive it from lifecycle events during
aggregation.

Queue delivery is at-least-once, so a raw `SummingMergeTree` directly over queue
deliveries would double-count a retry. The safe base is one idempotent row per
source event in a `ReplacingMergeTree` keyed by tenant and `EventId`. Queries
deduplicate source-event identities explicitly and must not rely on background
merges having already happened. We add another aggregate table only when a
concrete dashboard query justifies its storage and merge cost.

Langy's UI, authorization checks, busy guard, process manager, and worker
dispatch never query the analytical tables. Analytical lag affects charts, not
the chat. Analytics projection replay emits no domain events or external
effects.

The unpublished ClickHouse `langy_conversations`,
`langy_conversation_turns`, and `langy_messages` migrations are removed from
this branch. ClickHouse keeps the canonical event log and the content-free
analytics event table; there is no legacy operational read path.

### 3. Event subscribers receive committed events, not folds

The event-sourcing API gains an event-only subscriber concept. A subscriber
receives the committed event already carried by GroupQueue plus tenant/stream
metadata. It cannot receive `foldState`.

GroupQueue provides hot-path retry, ordering, and deduplication. A worker
restart therefore resumes queued work without querying ClickHouse. An explicit
replay or repair reads canonical events from ClickHouse and re-stages them in a
mode that suppresses live side effects.

The first best-effort subscriber is the Langy freshness broadcast. It is gated
on successful Postgres fold persistence, but receives only the event and
publishes only an invalidation signal. Clients then read the committed Postgres
projection. This preserves signal-then-refetch without passing a fold snapshot
through the subscriber.

We will not add a separate policy abstraction in this pilot. A stateless
event-to-command rule can use an event subscriber until repeated use proves that
another named concept is valuable.

### 4. One conversation process manager owns long-running decisions

`LangyConversationProcessManager` is keyed by
`(projectId, conversationId)`. It consumes the conversation's committed queue
events in stream order and keeps compact private state in Postgres:

```text
conversation process
├── current turn id / status
├── title source (derived / auto / user)
├── automatic-title-requested latch
├── pending handoff turn id
└── archived marker
```

The process state contains no prompts, message parts, tool output, credentials,
run tokens, or handoff tokens. Those live in the Langy domain tables or the
short-lived Redis transport. Outbox messages reference a handoff key instead of
copying its sensitive payload.

Responsibility is split as follows:

| Existing reactor                   | New owner                               |
| ---------------------------------- | --------------------------------------- |
| `spawnAgent`                       | Process-manager worker-dispatch intent  |
| `agentTurnLiveness`                | Heartbeat-aware direct event subscriber |
| `langyTitleGeneration`             | Process-manager title-generation intent |
| `langyConversationUpdateBroadcast` | Event subscriber                        |

Started turns schedule a worker-dispatch intent. This pilot deliberately does
not schedule liveness wakes or emit redispatch/failure intents: durable event
activity is not proof that the ephemeral worker heartbeat is stale, and a
timer-only process could re-drive or fail a healthy long-running stream. The
heartbeat-aware liveness subscriber remains the sole owner until the process
manager has an explicit observed-liveness input contract.

The first successful completed turn may schedule one title-generation intent
while the title is still derived. A persisted latch prevents later counters,
timers, replays, or completed turns from retitling. A manual rename permanently
suppresses automatic title effects.

We will write this manager explicitly. The pilot will not introduce a saga DSL,
a workflow graph, a generic state-machine compiler, or a new service.

### 5. A narrow process outbox is required before effects own production

The existing `ReactorOutbox` remains specific to alert settlement and delivery.
Langy will not reuse or generalize it.

The process manager does need a small transactional outbox. Updating process
state and then directly calling the worker leaves a crash window; calling the
worker first can duplicate work if the state transaction fails. The process
transition and its intent must commit together.

Three generic process tables are sufficient:

| Table                    | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `ProcessManagerInbox`    | Consume each source event once per process               |
| `ProcessManagerInstance` | Versioned JSON state plus `nextWakeAt`                   |
| `ProcessManagerOutbox`   | Idempotent command/effect intents with lease/retry state |

The uniqueness contracts are:

```text
(processName, projectId, sourceEventId)
(processName, projectId, processKey)
(processName, projectId, messageKey)
```

One Postgres transaction consumes the inbox identity, advances the process row,
and inserts deterministic outbox messages. The pilot outbox identities are
`dispatch:<turnId>` and `title:<turnId>`. Dispatch and title intents are durable;
heartbeat-aware recovery remains outside the process manager.

A small worker loop leases due outbox rows using `FOR UPDATE SKIP LOCKED`.
Postgres is the recovery path after a worker restart. Effects are at-least-once
and their handlers remain idempotent. The process manager, process store, and
outbox dispatcher land together and own initial worker dispatch and automatic
title generation. The liveness subscriber may idempotently re-dispatch a stalled
turn.

The existing ClickHouse-event-log-to-GroupQueue dispatch is the event
publication path, so a second event-publication outbox is unnecessary. The
process outbox solves a different problem: atomically committing a process
transition and the effect it intends to dispatch.

### 6. Redis is removed from durable Langy state, not from streaming

The resulting Langy operational path has no `RedisCachedFoldStore`. Postgres owns
the rebuildable conversation/turn/message projections and is immediately
readable after each projection commit.

Redis remains for data whose loss is explicitly tolerable or recoverable:

- streamed token/status frames;
- heartbeat recency;
- a short-lived spawn handoff containing credentials/prompt/run token; and
- GroupQueue transport.

A Redis outage may interrupt a live turn and trigger bounded recovery. It cannot
erase an accepted event from ClickHouse, a committed Postgres projection,
process state, or effect intent. Queue work lost with Redis is recoverable by
re-driving the canonical event log.

## Implementation and validation

Langy is not live and every affected table/path exists only on this branch.
There is no dual-run, feature flag, customer backfill, canary owner switch, or
rollback projection to preserve. The branch lands one complete architecture:

1. Add the Postgres operational-projection and process inbox/state/outbox
   tables. Keep ClickHouse `event_log` and the existing event schemas.
2. Register the Postgres conversation/turn state projections and message map;
   remove the unpublished ClickHouse operational tables and Redis fold cache.
3. Register one content-free `langy_analytics_events` ClickHouse map projection.
   Do not add a second rollup table until a concrete dashboard query needs it.
4. Register the conversation process manager and its live Postgres outbox for
   worker dispatch and one-shot title generation.
5. Register broadcast and heartbeat-aware liveness as direct event subscribers.
   Liveness remains outside the process until it has an observed-heartbeat input.
6. Keep canonical replay able to rebuild Postgres state and ClickHouse analytics
   without invoking subscribers, process effects, or the outbox.
7. Merge only after the complete path passes migration, retry, duplicate,
   restart, replay, authorization, content-safety, and OTel tests.

Acceptance gates:

- ClickHouse `event_log` remains the sole event source of truth;
- a queue envelope is staged only after its event-log append succeeds;
- normal fold/process/subscriber handling does not re-read the event from
  ClickHouse;
- a missed event-log-to-queue dispatch is observable and repairable from the
  ClickHouse log;
- the Postgres projection meets a defined convergence-latency SLO, and
  freshness is never broadcast before its fold commits;
- duplicate commands and duplicate event delivery do not double-fold or create
  duplicate effects;
- no Langy operational code or process decision queries ClickHouse analytical
  projections;
- the pilot process schedules no liveness wake and cannot redispatch or fail a
  turn from durable activity alone;
- a worker restart recovers queued work, process inbox work, and outbox intents
  without querying ClickHouse;
- ordinary replay emits no subscriber side effects or process outbox messages;
- Redis loss cannot erase committed Langy data or process/outbox work, although
  it can interrupt live streaming and the current liveness path;
- ClickHouse analytics converge after pause/restart/replay;
- event-consumer lag, oldest outbox age, and retry/dead counts are observable.

## Rationale / Trade-offs

Postgres is the better database for Langy's operational shape: small ordered
streams, row locks, uniqueness constraints, transactions, and low-latency point
reads. ClickHouse remains the better database for scanning and aggregating many
turns across tenants and time.

This keeps one event store for the platform. The event and process interfaces
should be clean enough to reuse, but generalization waits until a second domain
proves the same shape.

The process outbox is additional machinery, but omitting it would invalidate
the durability claim the process manager exists to provide. Keeping it separate
from the alert outbox avoids coupling workflow commands to alert-specific
settlement, cadence, payload, and operator semantics.

Moving projected message content to Postgres changes the hybrid-deployment data
boundary established by ADR-046. Before release, the deployment topology must
prove that this Postgres database is in the same customer-controlled data plane
as the current Langy ClickHouse storage. If that is not true for a supported
topology, content-bearing projections must stay customer-side or carry opaque
customer-side object references. This is a release gate, not a reason to put
operational state back in ClickHouse.

## Consequences

- Langy gets fast Postgres operational reads without a Redis projection cache;
  those reads are queue-lagged rather than transactionally read-after-write.
- Projection logic remains. The operational fold consumes queued events into
  Postgres, while ClickHouse remains the event authority and analytics store.
- Process decisions are independent of query projections.
- Redis remains in the live transport but leaves the durable state path.
- The platform gains a small event-subscriber seam and reusable process inbox,
  state, and outbox persistence. Durable timers remain a future capability
  rather than a Langy pilot behavior.
- The pilot adds Postgres storage and worker polling load; both are bounded by
  Langy's low event volume and indexed process queries.

## Amendment (2026-07-19): migrated onto the ADR-052 builder

The pilot landed its process manager by hand: a literal `ProcessDefinition`, a
literal `Record<intentType, IntentHandler>`, a bespoke subscriber, and a
`ProcessManagerService` / `OutboxDispatcherService` / `ProcessOutboxWorker`
trio constructed in `pipelineRegistry`. That predated the ADR-052 builder;
`eventSourcing.ts` still carried the note that "only Langy still hand-rolls its
outbox".

It is now declared on its own pipeline via `.withProcessManager`, exactly like
`triggerSettlement` and `topicClustering`. **No behaviour changes** — the same
events produce the same decisions and the same two intents. What changes is
ownership:

- the topology (state, intents, content boundary, per-event decisions, outbox
  lease) is declared in one place instead of split across four files;
- intent payloads are schema-validated at emit time, not only at dispatch;
- message keys are auto-qualified `process:<conversationId>:<key>`, so two
  conversations cannot collide on one turn id;
- the process inbox keys on `idempotencyKey ?? id`, so a redelivered command
  is a logical no-op rather than a second physical event;
- `ProcessRuntime` owns the manager, subscriber and outbox worker, and stops
  them with `EventSourcing.close()`.

Liveness is still **out**, for the reason given above: durable event activity
is not proof the ephemeral heartbeat is stale. The process declares no
`.schedule()` and no wake handler, and `agentTurnLiveness` remains the sole
liveness owner. Moving it to `nextWakeAt` + a fail-turn intent needs an
observed-liveness input contract, and is the natural follow-up.

## References

- Behavioral spec: [`specs/langy/langy-projection-independent-reactions.feature`](../../../specs/langy/langy-projection-independent-reactions.feature)
- Current pipeline: `langwatch/src/server/event-sourcing/pipelines/langy-conversation-processing/pipeline.ts`
- Current process manager: `langwatch/src/server/event-sourcing/pipelines/langy-conversation-processing/process-manager/`
- Current direct subscribers: `langwatch/src/server/app-layer/langy/subscribers/`
- Current registration: `langwatch/src/server/event-sourcing/pipelineRegistry.ts`
- Related ADRs: ADR-030 (alert outbox), ADR-034 (ClickHouse analytics materialization), ADR-046 (Langy event-sourced conversations)
