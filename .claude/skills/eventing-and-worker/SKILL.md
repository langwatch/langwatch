---
name: eventing-and-worker
description: "Event-sourced work on a module's pipeline: definePipeline, commands and events, projections (fold/map), subscribers, peer subscribers (withPeerSubscriber), scheduled process managers (.schedule({ everyMs }).onWake), intents and the outbox, background and periodic work, the worker role vs api vs tasks, at-least-once delivery and per-aggregate ordering, fact events, read hints and projection cursors (event id = k-sortable cursor), one-shot tasks. Use when someone says 'add a projection', 'add a subscriber', 'react to another module's event', 'scheduled job', 'cron', 'background job', 'periodic sweep', 'process manager', 'idempotent', 'retry', 'dead letter', 'worker', 'why did the worker not run it', 'tenant purge', 'projection cursor', or opens modules/*/process/src/eventing/."
user-invocable: true
---

# Eventing and the worker role

Record: `dev/docs/ARCHITECTURE.md` section 9 (eventing), 9.1 (purge, erase, retention), the "Projection cursor
reads" paragraph of 10, section 4 for the roles. Rulings are there; this skill points and warns.

Not here: how modules are installed, how a pipeline gets its stores, peers or secrets, and how `boot()`
wires roles. Those are §3.3, §4 and §5, taught by `backend`. Do not
hand-wire a consumer into the api role; the types refuse it.

## The model in five lines

- A module declares its **whole pipeline once**: `definePipeline({ name, aggregate })` then
  `.withEvents([...schemas])` (the contract's zod event schemas), `.withCommand(...)`, projections,
  subscribers, process managers. Today's builder methods are in
  `packages/eventing/src/pipeline/staticBuilder.ts`; the record's section 9 sketch uses the target
  spellings (section 16 maps them).
- **Commands** validate and append. They run in every role.
- **Projections, subscribers, process managers and scheduled work** are worker-only. The api role never
  constructs them: "api produces, worker consumes, tasks produces".
- Delivery is **at least once**. Ordering is **per aggregate** (group queue). One poisoned aggregate
  retries with backoff and does not block its neighbours.
- The hand-off from append to reactions is durable (outbox). Nothing is logged and dropped.

## The rules that matter

Each rule lives in §9; this table only points at it.

| Rule                                                                                                             | Record      |
| ---------------------------------------------------------------------------------------------------------------- | ----------- |
| Idempotent handlers: throw to be retried, never swallow                                                          | §9          |
| Background work is a scheduled process manager (`.schedule({ everyMs }).onWake`); no jobs, timers or cron routes | §9          |
| Keyed calendar work is a process manager keyed by the entity (`nextWakeAt`); `ScheduledJob` is retired           | §9, §15     |
| Fact events, not trigger events: the owner records the fact, no relay module                                     | §9          |
| React to a peer with `.withPeerSubscriber`; write your own rows                                                  | §9          |
| A delivery is `requestDelivery`, not a reaction                                                                  | §9, ADR-167 |
| Cross-module work is commanded by the owners, each touching only its own rows                                    | §9.1        |
| Nothing slow in a request: a command plus a process manager; a poll reads the fold                               | §9          |
| No `any` in events, commands or state; a queued payload is `unknown` until parsed once                           | §9          |
| Eventual consistency: write optimistically or answer "pending"; never a peer cycle                               | §3, §5      |

## Worked example: automation's `automations` pipeline

`modules/automation/process/src/eventing/automation.pipeline.ts` is the full exemplar. Its shape:

```ts
definePipeline({ name: "automations", aggregate: defineAggregate({ type: "trigger" }) })
  .withEvents([triggerMatchRecordedEventSchema, ...reportScheduleEventSchemas])
  .withCommand("recordTriggerMatch", RecordTriggerMatchCommand, { serializeByAggregate: true })
  .withProcessManager("graphAlertSweep", (pm) =>
    pm
      .state(graphAlertSweepStateSchema, { lastSweepAt: null })
      .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS })
      .onWake(graphAlertSweepWake)
      .intent("evaluateGraph", sweepSchema, runGraphAlertSweep(deps.scheduledIntents, deps.retention)),
  )
  .withPeerSubscriber("traceSpanTriggerMatch", {
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    data: spanReceivedEventDataSchema.pick({}),
    options: settlePerAggregate({ lane: "traceSpanTriggerMatch", delay: 30_000, ttlMs: 30_000 }),
    handle: (_data, context) => deps.peerReactions.handleTraceActivity({ ... }),
  })
  .build();
```

- The wake handler is its own small file, pure over state and `ctx`
  (`eventing/graph-alert-sweep.process.ts`): it returns the next state and `ctx.intent(name, key, payload)`.
  Intents carry a message key, which is the outbox's dedup identity.
- The trace and evaluation owners know nothing of automation. `data: ....pick({})` takes only the fields
  the reaction reads; the folded state is read through `TraceApi`/`EvaluationApi` at handling.
- Peer subscriber `options` (delay, dedup, group lane) are main's settle windows, kept per aggregate or
  per tenant.
- The module installs the pipeline with one `defineEventingModule({ pipeline, build, connect })`
  (`eventing/automations.pipeline.ts`); a module with several pipelines installs each the same way.
  Subscriber handling lives in a service, not in the pipeline file.
- Spec: `modules/automation/specs/automation-peer-subscribers.feature`.

For a plain subscriber on the module's own events see
`modules/organization/process/src/eventing/seat-limit.pipeline.ts` (`.withEventSubscriber`). For projections
see `modules/authz/process/src/eventing/authz-grant.pipeline.ts` (`.withClickHouseMapProjection`,
`.withProjectionSubscriber`); the framework specs are in `packages/eventing/specs/`.

## Reads, hints and cursors (the pipeline's side)

- A contract names what makes a read stale: `.query(name, { invalidatedBy: [EVENT_TYPE] })`. One
  framework subscriber turns each committed event into a hint on the tenant channel. See `api-transports`.
- A projection-backed read declares `fromProjection`. The **cursor is the event id alone**, never a
  `(timestamp, id)` tuple. Freshness is `freshnessOf`, which decodes the KSUID's seconds; never compare
  ids as plain strings, and a newer id does not prove older events applied (§10, "Projection cursor reads").
- Only projections a read names advance a cursor. Hints are sent from the cursor advance. Erasure and
  retention go through events the projection applies. Time-relative reads stay off this path.
- Specs: `packages/eventing/specs/projection-cursor-reads.feature`, `packages/api/specs/read-hints.feature`.

## The three roles

|                                                       | api       | worker | tasks     |
| ----------------------------------------------------- | --------- | ------ | --------- |
| commands                                              | send      | send   | send      |
| projections, subscribers, process managers, schedules | not built | hosted | not built |
| transports                                            | yes       | none   | none      |

Consumers register drain-first, so shutdown drains the worker before the api closes. A stack missing the
worker serves pages and silently processes no jobs.

## One-shot work: tasks

A migration, backfill or repair that runs before serve is a `Task` (`@langwatch/task`), never a loop:
`modules/automation/process/src/tasks/report-schedule-backfill.task.ts` (`name`, `description`, `run()`).
Run by the `tasks` app. Recurring work is a scheduled process manager instead.

## Traps

| Trap                                                                   | Instead                                   |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| a reactor, or a subscriber that writes another module's rows           | peer subscriber writing your own rows     |
| `setInterval` or a cron route for a sweep                              | scheduled process manager                 |
| a reverse `*Api` read to learn "did it happen"                         | subscribe to the owner's fact             |
| a handler that is not safe to run twice                                | key the write on the event or intent id   |
| renaming an event, aggregate or pipeline string born before this drive | leave it; new ones may change             |
| a projection touching another module's table                           | the owner exposes an event or `*Api` read |
| polling a run's status from the UI on a timer                          | read hints plus the fold                  |

## Tests

Pipelines are tested over memory twins and the event store memory tier; redelivery gets its own test
(`eventing/__tests__/trace-alert-trigger-match.subscriber.redelivery.test.ts` delivers twice and asserts one
effect). Worker installation: `app/__tests__/automation-worker-installation.unit.test.ts`. See `testing`.
