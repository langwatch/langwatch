# ADR-021: Transactional outbox for stake-sensitive reactor dispatch

**Date:** 2026-05-28 (revised 2026-06-01 — see "Revision" below)

**Status:** Accepted (revised)

## Context

LangWatch reactors today dispatch side effects in-line: the matching handler (e.g. `alertTrigger.reactor`) calls `sendSlackWebhook` / `sendTriggerEmail` / `addToDataset` synchronously inside `handle()`. Failures are wrapped in `try/catch`, logged, and captured to PostHog — but the trigger UI shows nothing, there is no retry, no operator-visible "stuck" state, and no audit trail of past dispatches.

This is acceptable for **best-effort** reactors (UI broadcasts, fold sync, cache invalidations) where missing one invocation is a non-event. It is unacceptable for **stake-sensitive** reactors — those that produce customer-visible side effects (emails, Slack messages) or write to LangWatch-managed systems on the customer's behalf (dataset rows, annotation queue items) — where a missed dispatch is either a customer-trust violation or data loss.

Two distinct operational pains today:

1. **Silent dispatch failures.** A 4xx from Slack ends as a captured exception with no signal to anyone running the trigger. We discover it via support tickets.
2. **No retry semantics.** A transient SES 5xx kills a dispatch that should have retried in 30 seconds.

The reactor framework currently makes no distinction between these two reactor classes. The default is "best-effort with silent failure," which is the wrong default for half the reactors we run.

## Decision

Introduce a **transactional outbox** as the durable substrate for stake-sensitive reactor dispatch — implemented as a **dedicated GroupQueue (the source of truth for scheduling and execution) plus a PG audit projection (the source of truth for history and operator visibility)**.

Concretely:

- A dedicated `outboxDispatchQueue` (a `GroupQueueProcessor`, separate from the main event-sourcing queue) owns dispatch **execution**: dedup, per-trigger FIFO via groupKey, delayed dispatch for cadence windows (via `delay` + `processBatch` for coalescing), per-tenant fairness, lease/heartbeat, retry-with-backoff. The queue's `process` callback **is** the dispatcher. Reactors registered via `.withOutbox` use this path going forward.
- A PG table `ReactorOutbox` holds one row per dispatch, **maintained by a queue-side audit adapter**. The adapter receives every queue lifecycle event (`onEnqueue`, `onLeased`, `onDispatched`, `onFailed`, `onDead`) and writes the corresponding row state. Operators query PG for activity feeds, stuck-state alerts, retry buttons — never Redis.
- A new framework primitive `.withOutbox(...)` on the pipeline builder lets reactors opt into this path (see [ADR-024](./024-withoutbox-pipeline-builder-primitive.md)).
- The **match** half of the reactor runs in-band on the main event-sourcing queue (inheriting `_originGuardedReactor`'s loop-prevention guards) and calls `outboxQueue.send(payload, …)` per match. The queue's dedup config absorbs replay.
- The **dispatch** half runs in the outbox queue's `process` callback. Failures throw `DispatchError` ([ADR-027](./027-typed-dispatcherror-contract.md)); the queue's retry semantics handle backoff, and the adapter mirrors each transition to PG.
- Best-effort reactors stay on `.withReactor` — no change to their execution model.

**The queue is the source of truth for dispatch execution.** **The PG row is the source of truth for dispatch audit.** Both must agree on every transition, which is why the adapter lives inside the GroupQueue rather than alongside it — every lifecycle event publishes through one hook that cannot be bypassed.

Replay safety comes from the queue's dedup config (`(reactorName, dedupKey)` collapses replayed enqueues onto the existing pending job) plus, for trigger reactors, `TriggerSent` as the cross-pipeline match claim ([ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md)).

### Revision (2026-06-01)

This ADR was originally written with **PG as the source of truth for both scheduling and audit** — `OutboxRepository.leaseGroup` / `leaseNext` / `markDispatched` polled and mutated PG rows directly, and a separate "wakeup queue" only signaled when rows were ready. That meant we re-implemented scheduling (delays, retries, leasing, FIFO) on top of PG when the in-house `GroupQueue` already had every one of those primitives.

The revised design (above) keeps the same external behavior — durable retry, operator visibility, replay safety — but consolidates execution on the GroupQueue and lets PG go back to being a write-mostly audit log. Less code, one queue primitive instead of two, and the dual-state-sync hazard goes away because the adapter is the only writer of `ReactorOutbox` from runtime.

**Phased rollout.** The Phase-0 outbox infrastructure (`OutboxDrainer`, `OutboxRepository.leaseNext` / `markDispatched` / `markRetry` / `recoverExpiredLeases`, the `wakeupQueue` carrying wakeup-only payloads) was deployed alongside this ADR's original draft. Removing it now would risk leaving any in-flight Phase-0 dispatch behind. So the queue-driven path **coexists** with the Phase-0 path:

- New reactors register via the queue-driven path with `auditAdapter` wired.
- Existing Phase-0 code stays in place; `OutboxDrainer` becomes dead code once every reactor that used to register with it has migrated.
- A follow-up cleanup PR (out of scope here) drops the Phase-0 drainer + lease* methods + the `leasedUntil` / `nextAttemptAt` columns from `ReactorOutbox`. That migration converts the schema to its end state — `scheduledAt` replaces `nextAttemptAt` as the audit field, and `leasedUntil` goes away because the queue owns the lease.

## Rationale

### Rejected alternative: event-sourced dispatch

Emit a `TriggerDispatchScheduled` event from the matching reactor, have a separate reactor consume it and perform the dispatch, emit `TriggerDispatched` / `TriggerDispatchFailed` events as outcomes. This is the "canonical" event-sourced shape and was the first design considered.

Rejected because:

- **Replay danger.** A replay of the trace event stream would re-emit dispatch events, which would re-fire customer emails. Loop-prevention guards in `_originGuardedReactor` don't help — by the time the dispatch reactor sees the event, it's too late to know it came from a replay.
- **Too many hops.** Six pipeline stops (`span_received → projection → alertTrigger → emit → dispatch reactor → dispatch → emit outcome`) for what is fundamentally "send this email."
- **Head-of-line blocking.** Dispatch failures would back up the trace-processing event stream, which the fold projections also depend on. A failing Slack retry could slow span ingestion.

### Rejected alternative: extend in-line dispatch with hand-rolled retry

Each reactor adds its own retry loop, its own error categorization, its own status tracking column. Rejected because every reactor would re-implement the same wheel slightly differently, there'd be no shared operator surface, and the retention/cleanup story would diverge per-reactor.

### Why outbox-as-table (audit projection, not source of truth)

A PG table gives us durability (outlives Redis), queryability (operator UI reads rows directly), and the structured `status` enum operator dashboards key off of. The state-machine semantics of a table — atomic UPDATEs, explicit transitions — match the reasoning model better than an append-only event log when the question is "is this dispatch done or not?"

What it does **not** need to do — and what the revised design removes — is own the scheduling primitive. The GroupQueue already has dedup, per-group FIFO, delay, retry with backoff, lease/heartbeat, and per-tenant fairness. The original ADR re-implemented all of that as PG queries (`leaseNext`, `leaseGroup`, `markFailedRetryable` with `nextAttemptAt` arithmetic) because the queue's role was scoped to "wake the drainer when something is ready." The revised design promotes the queue to source-of-truth for execution and demotes the table to audit projection — the wins are: ~40% less framework code, no `leaseGroup` race against the queue, and no opportunity for the two views to drift.

### Why the audit adapter lives inside the GroupQueue

The adapter mirrors **every** queue lifecycle event into PG. If it lived as a sibling consumer (a second subscriber to queue events, or worse a polling reconciler), there'd be windows where the queue has dispatched a job but PG still says `enqueued` — exactly the dual-state-sync hazard the revision is supposed to remove. Embedding the adapter as a `QueueAuditAdapter?` field on `GroupQueueProcessor` means every lifecycle hook fires through it before the queue considers the transition complete; the queue cannot mark a job dispatched without the adapter having seen it.

Adapter writes are still best-effort relative to dispatch: a PG outage logs and metrics but does not block Redis-side execution (the queue keeps running, the adapter retries, the projection catches up). Operator dashboards alert on adapter-lag metrics when reconciliation falls behind.

## Consequences

- **`ReactorOutbox` table in PG** (defined in [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md)) — written exclusively by the adapter on the queue-driven path, read by operator surfaces. Bounded size at steady state (one row per pending or recently-completed dispatch, 30-day retention for `dispatched` rows, 90 days for `dead`). The end-state schema (no `leasedUntil`, `scheduledAt` in place of `nextAttemptAt`) is finalised in the follow-up Phase-0 cleanup PR, not this one.
- **New framework primitive:** `.withOutbox` on `StaticPipelineBuilder`, framework code under `src/server/event-sourcing/outbox/` (covered by ADR-024).
- **New worker infrastructure:** a dedicated `outboxDispatchQueue` (a `GroupQueueProcessor`, separate from the main event-sourcing queue) whose `process` callback dispatches and whose `auditAdapter` writes audit rows. Coexists with the Phase-0 wakeup queue + drainer; new reactors use the new path.
- **`QueueAuditAdapter` interface** on `GroupQueueProcessor` — a reusable hook that any queue can opt into for PG-backed audit. The `PgOutboxAuditAdapter` is the first implementation; future queues (e.g., a future stake-sensitive command queue) can wire their own.
- **Phase-0 outbox primitives (`OutboxDrainer`, `OutboxRepository.leaseNext` / `markDispatched` / `markRetry` / `recoverExpiredLeases`, `wakeupQueue`) are deprecated but still present.** Removed in a follow-up cleanup PR once no reactor is registered on them.
- **New error contract:** dispatch endpoints throw a typed `DispatchError` so the worker can branch on retryable vs dead (covered by [ADR-027](./027-typed-dispatcherror-contract.md)).
- **Two reactor classes now exist** in the system: best-effort (`.withReactor`) and stake-sensitive (`.withOutbox`). Authors and reviewers must choose at definition time. The default for new reactors should be `.withReactor` unless the side effect is auditable.
- **Operator surfaces** (activity tab, retry buttons, Grafana alarms on stuck-queue depth) become possible and necessary. Without them the outbox is just an extra hop.
- **`evaluationTrigger.reactor` stays on `.withReactor`.** It dispatches commands (event-sourced, in-band), not side effects. Outbox is for out-of-band side effects only.
- **Silencing has no integration point yet.** Notify-side mute ("stop pinging me for an hour, prod is degraded") is a common follow-up ask, and it belongs between match and dispatch — not inside the outbox state machine itself, not inside the dispatch handler. Today's pipeline has no such hook. Out of scope for this ADR; flagged so the next person designing silencing knows the outbox is the scaffolding, not the home.
- **Match + delivery are currently bundled on the `Trigger` row.** Filters, action, channel, cadence (ADR-025), templates (ADR-026) all live on one row. Workable for one-action-per-trigger. The natural future split is a separate `NotificationPolicy` (or similarly named) row that holds delivery config, leaving `Trigger` as the match definition — same migration cost whenever it happens, but worth flagging that the new cadence/template columns being added by ADR-025/026 could equally land on a new table now. This PR doesn't make that split; capturing it here so the trade-off is visible the next time the schema is touched.

## References

- ADR-007 — Event sourcing architecture (the framework this extends)
- [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md) — Two-tier dedup
- [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md) — GroupQueue wakeup pattern
- [ADR-024](./024-withoutbox-pipeline-builder-primitive.md) — `.withOutbox` builder primitive
- [ADR-025](./025-notify-persistent-action-classification.md) — Notify vs persistent action classes
- [ADR-027](./027-typed-dispatcherror-contract.md) — DispatchError contract
- PR #4221 — `_originGuardedReactor` loop prevention this builds on
- PR #3528 — current in-line dispatch (the baseline this replaces for stake-sensitive reactors)
