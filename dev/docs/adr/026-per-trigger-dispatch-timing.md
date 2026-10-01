# ADR-026: Per-trigger dispatch timing uses settle windows and notification cadence

**Date:** 2026-05-28

**Status:** Accepted

**Behavioural contract:**
[per-trigger dispatch timing](../../../specs/automations/dispatch-timing.feature)

**Related:**
[automation process managers](./052-automations-on-process-manager-substrate.md)
and [persist-class debounce](./035-persist-class-debounce.md).

## Context

Automation actions have two different timing needs:

- traces are assembled from spans over time, so filters should observe a
  settled state rather than whichever partial state happened to arrive first;
- human-facing notifications need cadence windows to avoid storms, while
  dataset and annotation writes must preserve every matched trace.

These concerns are independent. Settlement controls when filters evaluate one
trace. Cadence controls when accepted notification matches are delivered.

## Decision

Every trigger stores two timing values:

| Setting               | Meaning                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `traceDebounceMs`     | Width of the deterministic activity window used before filter evaluation |
| `notificationCadence` | Wall-clock delivery window for human-facing notifications                |

`traceDebounceMs` is an integer duration. `notificationCadence` is a stable
string vocabulary whose supported values include immediate, five-minute,
fifteen-minute and hourly delivery.

### Every action has exactly one class

```ts
const NOTIFY_TRIGGER_ACTIONS = new Set(["SEND_EMAIL", "SEND_SLACK_MESSAGE"]);

const PERSIST_TRIGGER_ACTIONS = new Set(["ADD_TO_DATASET", "ADD_TO_ANNOTATION_QUEUE"]);
```

The sets are exhaustive and disjoint. Notification cadence is available only
to notify actions. Persist actions dispatch each accepted match without a
digest window.

The classification is shared by persistence, dispatch and UI code; no layer
re-derives it from display labels.

### Settlement uses anchored activity windows

The logical identity of a settle round includes the debounce width and:

```text
floor(occurredAt / max(traceDebounceMs, 1))
```

Activity delivered more than once within the same window records one logical
match. Activity in a later window records a new match and can move the durable
wake forward. A zero debounce uses one-millisecond windows, which preserves
redelivery idempotency while allowing later activity to evaluate eagerly.

When the round is due, the automation process re-reads the latest available
trace projection exactly once and evaluates filters against that state. Two
triggers on the same trace settle independently because their process keys and
debounce widths are independent.

### Cadence snaps notify work to wall-clock boundaries

Persist actions and immediate notifications use the current dispatch time.
Digest notifications snap to the next wall-clock boundary:

```ts
function scheduledFor(actionClass, cadence, now) {
  if (actionClass === "persist" || cadence === "immediate") return now;
  const width = cadenceWindowMs(cadence);
  return new Date((Math.floor(now.getTime() / width) + 1) * width);
}
```

Snapping rather than adding a duration ensures concurrent matches share one
boundary. A digest contains each `(triggerId, traceId)` once. A later boundary
creates a new digest round.

Configuration changes apply to matches recorded after the change. An intent
already committed keeps the timing snapshot that made its identity and
delivery promise deterministic.

### Debounce and cadence compose in that order

The pipeline performs:

```text
candidate match
  -> deterministic settle window
  -> latest-state filter evaluation
  -> immediate persist intent OR cadence-bounded notify intent
  -> retry-safe dispatch
```

Settlement never drops a match merely because the configured pending-state
bound is reached. The process emits bounded early intent pages and records the
overflow for operators.

### Defaults are part of the contract

- Missing cadence data is interpreted as `immediate`.
- A new notify automation defaults to a five-minute digest in application
  authoring code.
- Persist automations do not expose cadence controls.
- Missing debounce data is interpreted as 30 seconds.
- The UI offers zero as the explicit eager-evaluation setting.

## Alternatives considered

A single timing setting cannot represent both trace readiness and notification
batching. A rolling debounce whose identity changes on every event cannot be
made durable and retry-stable without mutable queue identity. Per-recipient
cadence would also conflict with the one-action-per-trigger data model.

## Consequences

- Filters see a recent settled trace state instead of the first partial fold.
- Human-facing matches coalesce into bounded digests.
- Persist actions keep one intent per accepted trace.
- Timing identities are deterministic under retry and redelivery.
- `TriggerSent(triggerId, traceId)` remains the permanent notification claim
  across settle windows.
