# ADR-094: Simulation execution uses a per-run process manager

**Date:** 2026-08-06

**Status:** Accepted

**Behavioural contracts:**
[event-driven execution preparation](../../../specs/scenarios/event-driven-execution-prep.feature)
and [queued/running cancellation](../../../specs/features/suites/cancel-queued-running-jobs.feature).

**Related:** [Eventing framework boundary](../../../packages/eventing/adrs/20260820-eventing-framework-boundary.md)
and [automation process managers](./052-automations-on-process-manager-substrate.md).

## Context

Submitting a simulation run, cancelling it and deciding that it has stalled are
stake-sensitive lifecycle decisions. The execution pool and Redis pub/sub are
useful low-latency delivery mechanisms, but neither is the durable record that
an execution or cancellation must eventually reach a terminal outcome.

Each run therefore needs durable private state, scheduled watchdogs and
retryable external intent.

## Decision

### One process instance per scenario run

`simulation_run_execution` is keyed by `scenarioRunId` and registered on the
simulation-processing pipeline. It owns three intent types:

- `execute` submits the run to the execution pool;
- `cancel` broadcasts to the `scenario:cancel` Redis channel; and
- `finish` records a terminal run event.

Intent message keys are deterministic:

```text
execute:<runId>
cancel:<runId>
finish:<runId>:<reason>
```

The Eventing process store commits the source-event inbox marker, next process
state, wake and intents atomically. The leased intent dispatcher retries each
effect under the process definition's attempt policy.

### Wakes enforce lifecycle deadlines

Queued, started and activity events arm:

```text
nextWakeAt = lastActivity + STALL_THRESHOLD_MS
```

A due wake that still observes no newer activity emits a `finish` intent with
terminal `ERROR` and reason `stalled`.

A `cancel_requested` event for a running run emits the cancel intent and arms a
60-second cancel-grace wake. If no terminal event arrives within that grace,
the wake emits a terminal `CANCELLED` finish intent.

A queued run is finished as cancelled immediately and still emits the cancel
broadcast, because its execute intent may already be waiting behind an occupied
pool slot. A cancellation that precedes the queued event emits no broadcast,
because no execute intent exists.

### Subscribers declare the consistency boundary they need

Simulation post-event work consumes typed event payloads. An event subscriber
receives the committed event only. A projection subscriber may attach to a
named projection when it needs sequencing after that projection commits, but
its handler still reads contract-owned event data rather than treating a fold
snapshot as private workflow state.

Terminal simulation events carry the scenario, batch, set and trace identities
needed by their subscribers. Command handling derives omitted terminal
identities from the aggregate's own event history before the terminal fact is
recorded.

Subscribers and process managers do not run during projection replay.

### Per-trace metrics have an idempotent analytical projection

`simulationRunMetrics` maps each `metrics_computed` event to one
`simulation_run_metrics` row per trace. The ClickHouse table is a
`ReplacingMergeTree` keyed by tenant, scenario run and trace, so retry delivery
converges by source identity.

A materialized view writes `argMaxState` values into an
`AggregatingMergeTree` rollup. Additive state is not used because the same
source event can be inserted more than once under at-least-once delivery.

The simulation-run fold remains the product read model for aggregate total
cost, role cost and latency. The per-trace analytical table is a distinct
fact-grain repository and is not read implicitly by the process manager.

### Postgres carries no conversation content

Process inbox, state and intent rows contain only IDs, enums, timestamps and
the bounded execution target. `buildSimulationRunEventView` narrows each
committed event before the process-manager envelope is built, so conversation
content cannot enter Postgres through generic serialization.

Full conversation content remains in ClickHouse event and simulation
projections. Repositories return simulation contract types rather than raw
ClickHouse or Prisma records.

## Alternatives considered

Submitting directly from a best-effort subscriber leaves a crash window after
the event is accepted. Redis pub/sub alone cannot prove that a cancellation was
observed. Read-time stall decoration changes presentation without recording a
terminal domain fact, so downstream consumers cannot converge on it. A global
sweeper does not model per-run cancellation grace or execution ownership as
directly as a durable wake.

## Consequences

- A queued execution has a durable, retryable intent.
- Cancellation uses Redis for prompt delivery and a durable wake as its
  backstop.
- A stall is a recorded terminal outcome, not a UI-only interpretation.
- Replay cannot re-submit, cancel or finish a run.
- Postgres write amplification is bounded to compact per-run process data.
- Per-trace simulation metrics converge independently of the aggregate read
  model.
