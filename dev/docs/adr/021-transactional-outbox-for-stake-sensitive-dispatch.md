# ADR-021: Transactional outbox for stake-sensitive reactor dispatch

**Date:** 2026-05-28

**Status:** Accepted

## Context

LangWatch reactors today dispatch side effects in-line: the matching handler (e.g. `alertTrigger.reactor`) calls `sendSlackWebhook` / `sendTriggerEmail` / `addToDataset` synchronously inside `handle()`. Failures are wrapped in `try/catch`, logged, and captured to PostHog — but the trigger UI shows nothing, there is no retry, no operator-visible "stuck" state, and no audit trail of past dispatches.

This is acceptable for **best-effort** reactors (UI broadcasts, fold sync, cache invalidations) where missing one invocation is a non-event. It is unacceptable for **stake-sensitive** reactors — those that produce customer-visible side effects (emails, Slack messages) or write to LangWatch-managed systems on the customer's behalf (dataset rows, annotation queue items) — where a missed dispatch is either a customer-trust violation or data loss.

Two distinct operational pains today:

1. **Silent dispatch failures.** A 4xx from Slack ends as a captured exception with no signal to anyone running the trigger. We discover it via support tickets.
2. **No retry semantics.** A transient SES 5xx kills a dispatch that should have retried in 30 seconds.

The reactor framework currently makes no distinction between these two reactor classes. The default is "best-effort with silent failure," which is the wrong default for half the reactors we run.

## Decision

Introduce a **transactional outbox** as the durable substrate for stake-sensitive reactor dispatch.

Concretely:

- A new PG table `ReactorOutbox` holds one row per pending or recently-completed dispatch, with lifecycle `queued → dispatching → dispatched | failed_retryable | dead`.
- A new framework primitive `.withOutbox(...)` on the pipeline builder lets reactors opt into this path (see [ADR-024](./024-withoutbox-pipeline-builder-primitive.md)).
- The **match** half of the reactor runs in-band on the event-sourcing queue (inheriting `_originGuardedReactor`'s loop-prevention guards) and writes one outbox row per match.
- The **dispatch** half runs out-of-band on a separate worker that reads outbox rows and invokes the registered dispatch handler. Failures transition the row, not silently log.
- Best-effort reactors stay on `.withReactor` — no change to their execution model.

The outbox table is the **source of truth** for dispatch state. Operator surfaces (activity tab, retry buttons, Grafana alarms) read from it. Replay safety comes from the unique constraint + `createMany skipDuplicates` pattern already used by `TriggerSent`.

## Rationale

### Rejected alternative: event-sourced dispatch

Emit a `TriggerDispatchScheduled` event from the matching reactor, have a separate reactor consume it and perform the dispatch, emit `TriggerDispatched` / `TriggerDispatchFailed` events as outcomes. This is the "canonical" event-sourced shape and was the first design considered.

Rejected because:

- **Replay danger.** A replay of the trace event stream would re-emit dispatch events, which would re-fire customer emails. Loop-prevention guards in `_originGuardedReactor` don't help — by the time the dispatch reactor sees the event, it's too late to know it came from a replay.
- **Too many hops.** Six pipeline stops (`span_received → projection → alertTrigger → emit → dispatch reactor → dispatch → emit outcome`) for what is fundamentally "send this email."
- **Head-of-line blocking.** Dispatch failures would back up the trace-processing event stream, which the fold projections also depend on. A failing Slack retry could slow span ingestion.

### Rejected alternative: extend in-line dispatch with hand-rolled retry

Each reactor adds its own retry loop, its own error categorization, its own status tracking column. Rejected because every reactor would re-implement the same wheel slightly differently, there'd be no shared operator surface, and the retention/cleanup story would diverge per-reactor.

### Why outbox-as-table

A PG table gives us durability (outlives Redis), queryability (operator UI reads rows directly), and replay safety (unique constraint absorbs duplicate inserts from reactor replay). The state-machine semantics of a table — atomic UPDATEs, explicit transitions — match the reasoning model better than an append-only event log when the question is "is this dispatch done or not?"

## Consequences

- **New schema surface:** `ReactorOutbox` table in PG (defined in [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md)). Bounded size at steady state (one row per pending or recently-completed dispatch, 30-day retention for `dispatched` rows, 90 days for `dead`).
- **New framework primitive:** `.withOutbox` on `StaticPipelineBuilder`, framework code under `src/server/event-sourcing/outbox/` (covered by ADR-024).
- **New worker infrastructure:** outbox dispatch worker, scheduled via existing `GroupQueue` (covered by [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md)).
- **New error contract:** dispatch endpoints throw a typed `DispatchError` so the worker can branch on retryable vs dead (covered by [ADR-027](./027-typed-dispatcherror-contract.md)).
- **Two reactor classes now exist** in the system: best-effort (`.withReactor`) and stake-sensitive (`.withOutbox`). Authors and reviewers must choose at definition time. The default for new reactors should be `.withReactor` unless the side effect is auditable.
- **Operator surfaces** (activity tab, retry buttons, Grafana alarms on stuck-queue depth) become possible and necessary. Without them the outbox is just an extra hop.
- **`evaluationTrigger.reactor` stays on `.withReactor`.** It dispatches commands (event-sourced, in-band), not side effects. Outbox is for out-of-band side effects only.

## References

- ADR-007 — Event sourcing architecture (the framework this extends)
- [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md) — Two-tier dedup
- [ADR-023](./023-groupqueue-wakeup-pattern-for-outbox.md) — GroupQueue wakeup pattern
- [ADR-024](./024-withoutbox-pipeline-builder-primitive.md) — `.withOutbox` builder primitive
- [ADR-025](./025-notify-persistent-action-classification.md) — Notify vs persistent action classes
- [ADR-027](./027-typed-dispatcherror-contract.md) — DispatchError contract
- PR #4221 — `_originGuardedReactor` loop prevention this builds on
- PR #3528 — current in-line dispatch (the baseline this replaces for stake-sensitive reactors)
