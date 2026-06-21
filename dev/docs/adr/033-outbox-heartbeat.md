# ADR-033: Outbox heartbeat primitive

- **Status:** Accepted
- **Date:** 2026-06-20
- **Related:** ADR-030 (transactional outbox), ADR-034 (event-sourced analytics materialization — the consumer that motivated this primitive)

## Context

The transactional outbox (ADR-030) drives dispatch off events: a span lands, a fold updates, a reactor's `decide` returns enqueue requests. That covers everything *with* a triggering event.

Two real cases have no triggering event:

- **No-data detection.** A custom-graph alert that fires when the metric drops to zero has, by definition, no event to react to. The absence IS the signal.
- **Resolve-when-traffic-stops.** A firing alert that should clear when the metric stays below threshold for N minutes — same shape. "Still nothing happening" cannot be observed event-driven.

A K8s cron solved this historically (3-minute tick over all active triggers, project-blind). Moving the rest of trigger evaluation onto the event-sourced path (ADR-034 Phase 5) left the absence cases stranded. We need a primitive that periodically scans, but emits through the SAME dispatch path as event-driven enqueues — same dedup, same retry, same audit, one canonical handler regardless of what woke it up.

## Decision

Add a framework-level **outbox heartbeat**: a periodic, Redis-locked, worker-only scheduler whose registered entries return `OutboxEnqueueRequest[]` exactly as outbox reactors do. The scheduler routes those through `dispatchOutboxEnqueues` — the same helper `adaptOutboxReactor` uses — so every downstream concern (debounce TTL, dedup, retries, the typed handler) is shared.

```
HeartbeatRegistry  ──register({ name, intervalMs, decide })──▶  HeartbeatScheduler
                                                                     │
                                                                     ▼ tick (Redis leader-lock)
                                                                  decide(ctx)
                                                                     │ OutboxEnqueueRequest[]
                                                                     ▼
                                                             dispatchOutboxEnqueues
                                                                     │
                                                                     ▼
                                                            outbox.enqueueSettle / enqueueGraphEval
                                                                     │
                                                                     ▼
                                                              outbox.dispatcher.process
                                                                     │
                                                                     ▼
                                                              ONE canonical handler
```

Runtime constraints:

- **Worker-only.** `start()` is a no-op outside `processRole === "worker"`, so registration code is safe in shared modules.
- **Leader-elected per `name`.** Exactly one of N worker replicas runs each tick — `SET ... NX PX` with a worker token + Lua CAS-DEL release. Lock TTL = `max(intervalMs * 2, 30s)` so heavy work has room without losing the lock.
- **Errors are non-fatal.** A throwing `decide` is logged + captured; the lock releases either way; the next tick still fires.
- **Process-singleton registry.** A second `register(...)` for the same `name` throws, so accidental double-registration is loud.

The graph-trigger heartbeat (ADR-034 Phase 5) is the first consumer:
- 30s cadence.
- Two `decide`-time predicates: active triggers with the no-data operator/threshold combination, and active triggers with an unresolved `TriggerSent` row.
- **Source-aware pre-filter** (Phase 6 extension): per candidate trigger, look up the metric's source (`trace` | `evaluation`) via `field-availability`. Group candidates per `(project, source)` and issue ONE batched recency query per source per project per tick — `trace_analytics` for trace-source candidates, `evaluation_analytics` for eval-source candidates. If the project has any qualifying event newer than a candidate's window, the real-time outbox reactor is already firing for that trigger; skip.
- Surviving candidates enqueue `graphEval`-stage payloads. The shared handler `evaluateGraphTrigger` picks up — same handler the real-time reactor's payloads land at, regardless of source pipeline.

## Consequences

- One canonical handler for any given trigger type, regardless of whether an event or a tick woke it up. Test it once, reason about it once.
- The dispatch path's invariants (debounce TTL collapse, at-most-once via `TriggerSent`, retries, audit projection where applicable) apply to heartbeat-sourced enqueues for free.
- A heartbeat consumer must keep `decide` cheap. The pre-filter pattern (one batched query per project bounded by `max(window)`) is the discipline we hold to for the analytics consumer; future consumers should follow the same shape.
- The heartbeat does NOT replace the event-driven path. It supplements it for cases the event path structurally cannot reach. Any consumer tempted to "just re-enqueue everything every tick" should use `.withOutbox(...)` on the reactor side instead — it's cheaper, lower-latency, and avoids tick-quantised reaction delays.

## Implementation

- Registry + types: `src/server/event-sourcing/outbox/heartbeat/heartbeat.registry.ts`, `heartbeat.types.ts`.
- Scheduler: `src/server/event-sourcing/outbox/heartbeat/heartbeat.scheduler.ts`.
- First consumer (graph triggers): `src/server/app-layer/triggers/graph-trigger-heartbeat.ts`, registered from the worker bootstrap in `src/server/app-layer/presets.ts`.
