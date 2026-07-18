# Event-sourcing reactions

Use a subscriber for a lightweight live reaction. Use a process manager when
the system makes a durable promise. Both receive work through GroupQueue; a
process manager adds a transactional Postgres inbox, state/wake row, and
leased intent outbox after consuming its event.

```text
command → committed event → projections
                          ├→ subscriber (GroupQueue retry)
                          └→ process manager consumer (GroupQueue)
                                └→ inbox + state + intents (Postgres transaction)
                                      ├→ durable nextWakeAt
                                      └→ leased outbox executor
```

Reactions are live only. Projection replay does not invoke subscribers or
process managers.

## Subscribers

`withSubscriber` supports raw event delivery or sequencing behind a fold/map
projection:

```ts
.withSubscriber("triggerMatch", {
  fold: "traceSummary",
  events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
  when: event => isRelevant(event),
  delay: 30_000,
  ttl: 30_000,
  dedupId: event => String(event.aggregateId),
  handler: async (event, ctx) => {
    // ctx.state is the committed traceSummary fold.
  },
})
```

- `fold` or `map` sequences after that projection and supplies committed
  `ctx.state`.
- `events` filters event types. Without `fold`/`map`, it is a raw subscriber.
- `when` is a pure pre-enqueue filter.
- `delay`, `ttl`, `dedup`, and `dedupId` configure GroupQueue delivery.
- Fold state is inferred from the named projection through the builder chain.

Subscribers may read query projections and call services, but they must stay
lightweight at source-pipeline volume. Do not put per-trace Postgres process
state in a trace subscriber. When handing work to another pipeline, send IDs
and the smallest stable config snapshot, never customer content.

Subscriber loss is acceptable only when a later event, scheduled sweep, or
explicit re-drive heals it. If losing the decision pages someone, use a
process manager.

## Process managers

Mount a process manager on the pipeline whose committed events it consumes:

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
          ctx.intents.persistMatch(`persist:${m.traceId}`, m.payload)),
      ],
      nextWakeAt: due.nextBoundary,
    };
  })
  .outbox({ maxAttempts: 8, leaseDurationMs: 120_000 }))
```

`.on(EVENT_TYPE, ...)` declares the subscription. There is no `.trigger()`,
feed, or fact port. If another pipeline detects the condition, its subscriber
sends a command to the owning pipeline. The owning pipeline commits a normal
event, and the PM consumes that event through its inbox.

Scheduled singletons use the alternate staged form:

```ts
.withProcessManager("graphAlertSweep", pm => pm
  .state<SweepState>(init)
  .schedule({ everyMs: 30_000 })
  .onWake(sweep)
  .intent("evaluateGraph", sweepSchema, runSweep))
```

### Staging and purity

- Call `.state()` first.
- Declare intents before event/wake handlers when handlers emit them. The
  scheduled form can infer future intent factories from a typed wake handler.
- A manager needs at least one `.on()` handler or `.schedule()`.
- `.outbox()` is available only after an intent exists.
- `.on()` and `.onWake()` are pure, synchronous evolution. They receive time
  as `ctx.at`; never call `Date.now()` or perform I/O there.
- Intent executors are the I/O boundary. Throw retryable failures; return
  normally for successful or terminal outcomes.
- Every persisted intent payload has a Zod schema and deterministic message
  key. Event payloads are already validated by their owning pipeline.

### Idempotency and ordering

Commands that bridge an at-least-once subscriber must stamp a deterministic
event-level idempotency key. The PM runtime uses `event.idempotencyKey ??
event.id` as its transactional inbox identity. Thus physical duplicate rows
cannot evolve state twice.

Use the same aggregate ID for command grouping and process key when FIFO is a
domain guarantee. For automations that key is `triggerId`, so command handling,
event delivery, and PM consumption remain ordered per trigger while different
triggers run independently.

Intent message keys are scoped by process/project. Make them semantic and
stable (`digest:<boundary>`, `persist:<traceId>`), not random IDs.

## Store boundaries

- Event log and rebuildable audit/query projections: ClickHouse.
- Live delivery: GroupQueue.
- PM inbox, state, revision, `nextWakeAt`, and leased intents: Postgres.
- Irreversible cross-request claims such as `TriggerSent`: authoritative
  Postgres ledgers.

Process state and intents should hold IDs, timing, and bounded configuration.
Re-read trace/message content at the execution boundary from its canonical
store. This makes the persisted schemas a reviewable proof that customer
content is not copied into Postgres.

## Existing reactors

`withReactor` still exists for current plain post-projection reactors. Do not
mechanically migrate unrelated reactors while changing a domain. New code
should choose deliberately between `withSubscriber` and `withProcessManager`;
the removed `withOutbox` primitive is not an option.
