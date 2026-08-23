# ADR-052: Automations use a dedicated process-manager pipeline

**Date:** 2026-07-18

**Status:** Accepted

**Behavioural contract:**
[automation dispatch on the process-manager substrate](../../../specs/automations/process-manager-dispatch.feature)

**Related:** [per-trigger dispatch timing](./026-per-trigger-dispatch-timing.md),
[typed dispatch errors](./027-typed-dispatcherror-contract.md),
[email abuse protections](./031-trigger-email-abuse-protections.md),
[event-sourced analytics](./034-event-sourced-analytics-materialization.md),
[persist-class debounce](./035-persist-class-debounce.md),
[notification templates](./036-liquid-templates-for-trigger-notifications.md),
[webhook delivery](./040-webhook-http-request-automation-channel.md), and the
[Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md).

## Context

Automation settlement is stake-sensitive orchestration. A matching trace may
need to wait for more trace activity, join a notification cadence, survive a
queue flush, retry an external effect, or wake later to evaluate absence. A
best-effort subscriber is suitable for detecting a match, but it is not the
durable home of those promises.

Automations therefore own an event-sourced pipeline backed by the Eventing
process-manager substrate. Group Queue carries ordered work. Postgres holds
the durable process inbox, state, wakes and intent outbox.

## Decision

```text
trace pipeline                         evaluation pipeline
  trigger-match projection subscriber   trigger-match projection subscriber
              │ IDs + timing config only │
              └──────────┬────────────────┘
                         ▼ Group Queue command, grouped by trigger
                 automations pipeline
                 aggregate type: trigger
                    recordTriggerMatch
                         │
                 trigger_match_recorded
                         │ FIFO per trigger
                         ▼
                  triggerSettlement process manager
                  inbox + state + nextWakeAt
                         │
                         ▼
                  leased intent outbox
                  notifyDigest / persistMatch

                 graphAlertSweep process manager
                 scheduled singleton wake every 30 seconds
```

### Match subscribers carry IDs, not trace content

The trace and evaluation pipelines detect candidate matches only after their
required projection has committed. They send trigger ID, trace ID, action
class, timing configuration and the source event identity to the automations
pipeline. Trace, span and message content never enters an automation event or
a process-manager row.

Evaluation-filtered triggers are detected from the evaluation pipeline. Trace
filters are detected from the trace pipeline. Each subscriber applies the
source and origin guards owned by its feature before it records a match.

`recordTriggerMatch` uses the trigger ID as aggregate and queue identity. Its
idempotency key includes the trigger, trace, debounce width and anchored settle
window:

```text
triggerId : traceId : traceDebounceMs : floor(occurredAt / max(traceDebounceMs, 1))
```

Duplicate delivery within one window evolves the process once. Activity in a
later window is a distinct fact and can re-arm settlement.

### `triggerSettlement` owns timing and durable intent

There is one `triggerSettlement` process instance per project and trigger. A
match records the trace in compact state and chooses the earliest required
`nextWakeAt`. A wake:

- re-reads the settled trace before applying filters;
- emits one `notifyDigest` intent per due cadence boundary;
- emits bounded `persistMatch` page intents for due persist actions; and
- schedules the next durable wake when more work remains.

Pending state is bounded. When a match storm reaches the bound, the oldest
persist matches are flushed into bounded intent pages instead of being
dropped. Page identities include the settle window, so a later round cannot
be swallowed by an earlier completed page.

The process transition, inbox marker, next state and intent messages commit in
one Postgres transaction. Intent executors are at-least-once and retry-safe.
`TriggerSent(triggerId, traceId)` is the permanent notification claim;
dataset and annotation writes use deterministic identities or upserts.
Claims are written after a successful external effect so retryable failures
remain retryable.

### Dispatch errors form a closed retry contract

Intent executors throw `DispatchError` for expected delivery failures. A
retryable error is returned to the leased outbox retry ladder; a terminal
error is recorded and not retried. Unknown errors are treated as retryable
until the attempt cap. Provider bodies and credentials are never persisted in
an error record.

### Graph alerts use the same durable scheduling substrate

The real-time graph subscriber applies a five-second, non-extending project
debounce and calls the shared evaluator. `graphAlertSweep` is a scheduled
singleton for absence and resolve evaluation. Revision fencing ensures that
racing wake workers cannot both commit the same sweep.

The webhook delivery-log prune is also a scheduled process-manager singleton.
Automations do not require application cron jobs or a separate leader lock.

### Replay excludes customer effects

Subscribers and process managers are live-delivery registrations. Projection
replay invokes neither. Rebuilding trace, evaluation or automation projections
therefore cannot send a notification, persist a match, evaluate an alert or
run a webhook.

### Ownership and storage boundaries

- Automation services, repositories, provider adapters and delivery senders
  live in the automation application layer or feature package.
- Pipeline composition, subscribers and process definitions live with the
  automations pipeline in the application composition root.
- Eventing owns generic inbox, process-state, wake and leased-outbox contracts.
- Group Queue owns ordered background transport.
- Postgres process rows contain IDs, compact timing state and bounded intent
  payloads; never trace, span or message bodies.

## Alternatives considered

Best-effort subscribers alone cannot atomically preserve a future wake or an
external intent. A product-specific scheduler would duplicate the generic
process-manager inbox, revision fencing and leased delivery semantics. Running
filter evaluation directly on every trace event would also restore hot-path
amplification and make partially assembled trace state observable.

## Consequences

- Automations have one canonical event stream and per-trigger FIFO ordering.
- Settlement and cadence promises survive Redis loss once committed to the
  process store.
- External effects are retryable without copying trace content into Postgres.
- Wake polling may deliver a boundary a few seconds late, but cannot silently
  lose a committed promise.
- Operator tooling can inspect generic process instances, intent messages and
  attempt records through the application adapters.

## References

- [Automation process-manager behaviour](../../../specs/automations/process-manager-dispatch.feature)
- [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md)
- [Group Queue framework boundary](../../../packages/group-queue/adrs/20260820-group-queue-framework-boundary.md)
