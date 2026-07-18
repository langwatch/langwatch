# ADR-052: Automations on a dedicated process-manager pipeline

**Date:** 2026-07-18

**Status:** Accepted

**Supersedes:** ADR-030's `ReactorOutbox` mechanism and `.withOutbox`
pipeline primitive. ADR-026/027, ADR-031, ADR-034, ADR-035, ADR-036/041,
ADR-040, and ADR-043 remain behavioral contracts, subject to ADR-026's
2026-07-18 deterministic settle-window amendment.

## Context

Automation dispatch previously combined three delivery systems: fold-attached
outbox reactors, delayed settle/cadence/graph jobs in Redis, and a Postgres
`ReactorOutbox` audit shadow. Graph absence detection added a heartbeat
scheduler and Redis leader lock. Pending settlement disappeared on a Redis
flush even though the audit table continued to imply durability, and the
table itself became a high-volume production burden.

The generic process-manager substrate already provides the two promises this
domain needs: revision-fenced durable wakes and a leased transactional outbox.
Automations therefore move to that substrate and own an event-sourced pipeline
instead of mounting Postgres-shaped state on the high-volume trace pipeline.

## Decision

```text
trace pipeline                         evaluation pipeline
  post-fold triggerMatch subscriber      post-fold triggerMatch subscriber
              │ IDs + timing config only │
              └──────────┬────────────────┘
                         ▼ GroupQueue command, grouped by trigger
                 automations pipeline
                 aggregate type: trigger
                    recordTriggerMatch
                         │
                 trigger_match_recorded ─────► automationAudit map (ClickHouse)
                         │ GroupQueue, FIFO per trigger
                         ▼
                  triggerSettlement PM
                  transactional inbox/state
                         │ nextWakeAt
                         ▼
                  leased intent outbox
                  notifyDigest / persistMatch

                 graphAlertSweep PM
                 scheduled singleton wake every 30s
```

Every delivery hop uses GroupQueue: trace/evaluation subscribers, automation
commands, projections, and process-manager event consumption. Postgres is not
a competing transport. It is used only after PM consumption for durable
`nextWakeAt` state and leased outbox intents.

### Trace and evaluation subscribers

The trace pipeline mounts:

```ts
.withSubscriber("triggerMatch", {
  fold: "traceSummary",
  events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
  handler,
})
```

It runs after the fold commits, receives that committed fold as `ctx.state`,
and applies `passesTraceOriginGuards`. Evaluation-filtered triggers are left
to the equivalent `evaluationRun` subscriber. Both subscribers send only
trigger ID, trace ID, action class, action, debounce, and cadence. Trace/span
content never crosses into the automations event or Postgres PM tables.

`recordTriggerMatch` uses trigger ID as aggregate/group identity and stamps
`${triggerId}:${traceId}:${settleWindowBucket}` as the event idempotency key.
The bucket combines the configured debounce width with
`floor(occurredAt / max(traceDebounceMs, 1))`; including the width prevents a
configuration change from colliding with an earlier round. The PM runtime uses
that logical key for its transactional inbox, so duplicate activity within one
window can briefly create two physical ClickHouse rows without evolving the
process twice. Event-log reads and the audit projection also collapse the same
key. Activity in a later window records a new event and re-arms the process.

### Dedicated automations pipeline

The pipeline has aggregate type `trigger`, the `recordTriggerMatch` command,
an ID-only `automationAudit` ClickHouse map projection, and both automation
process managers. GroupQueue serializes commands and committed-event
consumption by trigger, preserving FIFO end to end.

Process managers subscribe by declaring `.on(EVENT_TYPE, handler)`. There is
no feed, fact port, `.trigger()`, or cross-pipeline PM mount. The runtime
derives the live event subscription from the declared event types and sends
the committed event through the transactional inbox.

### Approved builder API

```ts
.withProcessManager("triggerSettlement", pm => pm
  .state<SettlementState>(initialState)
  .intent("notifyDigest", notifyDigestSchema, sendDigest)
  .intent("persistMatch", persistMatchSchema, persistMatch)
  .on(TRIGGER_MATCH_RECORDED, (state, data, ctx) => ({
    state: addPending(state, data, ctx.at),
    nextWakeAt: settleBoundary(state, ctx.at),
  }))
  .onWake((state, ctx) => {
    const due = drainDue(state, ctx.at);
    return {
      state: due.state,
      intents: [
        ...due.boundaries.map(b =>
          ctx.intents.notifyDigest(`digest:${b.key}`, b.payload)),
        ...due.settledMatches.map(m =>
          ctx.intents.persistMatch(
            `persist:${m.traceId}:${m.settleWindowBucket}`,
            m.payload)),
      ],
      nextWakeAt: due.nextBoundary,
    };
  })
  .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }))

.withProcessManager("graphAlertSweep", pm => pm
  .state<SweepState>(init)
  .schedule({ everyMs: 30_000 })
  .onWake(sweep)
  .intent("evaluateGraph", sweepSchema, runSweep))
```

The phantom-typed stages require state first, make intent factories available
to evolve handlers, expose outbox configuration only after an intent exists,
and reject a PM with neither an event handler nor a schedule. Evolve handlers
are synchronous and pure: no I/O and no clocks; `ctx.at` supplies event or
wake time. Zod is required for persisted intent payloads, not transient event
typing.

### Settlement and dispatch

`triggerSettlement` has one instance per project/trigger. A match computes
`settleDueAt`, its deterministic settle-window bucket, and the ADR-026/027
cadence-snapped `dispatchDueAt` from the event timestamp, then stores the
earliest boundary as `nextWakeAt`. Duplicate activity in one bucket collapses;
activity in a later bucket records a new round and moves the pending wake. A
wake emits one `notifyDigest` per cadence boundary and one window-identified
`persistMatch` per settled persist-class trace. Pending state is bounded: a
match storm past the cap flushes the oldest matches to immediate dispatch
intents (degraded batching, never loss) and logs the flush count.

This is stronger than the old Redis-delayed settle path: once the PM commit
succeeds, a Redis flush cannot erase the pending boundary or intent.

Intent executors preserve the existing dispatch contracts: settled-fold
reconfirmation, ADR-031 retry-safe caps and suppression, claim-after-send
`TriggerSent` at-most-once behavior, dataset/annotation actions, and ADR-040
webhook SSRF protection, delivery log, and stable
`X-LangWatch-Event-Id`. Retryable errors throw for leased-outbox backoff;
Notify rounds in later windows remain suppressed after a successful send by
the permanent `(triggerId, traceId)` claim. A persist round whose filters fail
does not claim, so later trace activity gets a fresh window-identified intent
and can persist once the settled state passes.

### Graph alerts and replay

The lightweight real-time graph subscriber retains the five-second
non-extending project debounce and shared evaluator. `graphAlertSweep` is a
scheduled singleton that replaces the heartbeat cron and Redis leader lock;
revision fencing makes racing wake workers stand down. Candidate discovery
and absence/resolve semantics are unchanged. The ADR-040 webhook delivery-log
prune rides the same substrate: `webhookDeliveryPrune` is a daily scheduled
singleton, so the Helm chart ships no automation CronJobs at all.

Subscribers and generated PM consumers are live-delivery registrations. The
projection replay path invokes neither, so rebuilding trace, evaluation, or
automation projections cannot dispatch customer effects.

### Deletion and cutover

The entire `event-sourcing/outbox/` stack, six automation outbox reactors,
`.withOutbox`, `ReactorOutbox`, heartbeat scheduler, and Redis leader lock are
deleted. The `ReactorOutbox` table itself is NOT dropped in the cutover
release: a rolling deploy runs migrations while old worker replicas still
read and write the table, so dropping it here would crash them mid-drain.
The drop migration ships one release later (expand/contract), after the old
consumers and any drained rows are gone. Automation code consolidates:
services, repositories, dispatch helpers and delivery senders under
`server/app-layer/automations` (the `triggers` name is retired); process
managers, subscribers and dispatch wiring under
`server/event-sourcing/pipelines/automations`; provider definitions split
per side into `shared/automations/providers`,
`features/automations/providers`, and
`server/app-layer/automations/providers`. Consumers import the new
locations directly.

For one release, the global event router recognizes stale
settle/cadence/graphEval payloads, logs a warning, and acknowledges them. It
does not parse them as events or poison-retry them.

`withReactor` remains available for the unrelated plain reactors. Migrating
those reactors, scenario execution, Langy, topic clustering, caches, and
observability are outside this decision.

## Consequences

- Automations have one canonical event stream and per-trigger FIFO ordering.
- Postgres holds IDs, timing/config snapshots, state revisions, and intent
  payloads only; never trace/span/message content.
- Settlement and cadence promises survive Redis loss.
- `ReactorOutbox` write amplification and heartbeat infrastructure disappear.
- Wake polling can deliver a boundary a few seconds late, but cannot silently
  lose a committed promise.

## References

- [`specs/automations/process-manager-dispatch.feature`](../../../specs/automations/process-manager-dispatch.feature)
- [`specs/automations/dispatch-timing.feature`](../../../specs/automations/dispatch-timing.feature)
- ADR-049 (process-manager inbox/state/outbox)
- ADR-051 (durable revision-fenced wakes)
