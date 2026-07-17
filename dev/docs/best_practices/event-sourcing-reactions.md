# Reactions: subscribers and process managers

How side effects work in the event-sourcing system after ADR-052 — the
model, the API, how it maps onto everything it replaced, and a
guarantee-by-guarantee audit showing nothing was silently lost.

## The model in one page

Event sourcing here has exactly five concepts:

```
commands ──► events (ClickHouse event_log — the only truth)
                │
                ├──► fold projections   (per-aggregate state; CH + Redis write-through)
                ├──► map projections    (per-event rows; CH)
                │        …projections answer "what is true?" — rebuildable, no side effects
                │
                ├──► SUBSCRIBERS        best-effort reactions
                └──► PROCESS MANAGERS   promised reactions
                         …reactions answer "what should happen?" — never rebuildable
```

Everything is delivered by **one Redis GroupQueue** (per-aggregate FIFO,
at-least-once). A subscriber is nothing but a queue consumer. A process
manager's *inputs* ride the same queue, but from its Postgres commit onward
(inbox + state + outbox in one transaction) its promises are Postgres-driven
and survive Redis loss entirely.

The decision procedure is one question: **would you page someone if this
reaction silently didn't happen?** No → subscriber. Yes → process manager.

## The trigger descriptor

Both primitives share one trigger descriptor with two orthogonal dimensions:

- **Sequencing** — `fold: "name"` / `map: "name"` stages the handler *after
  that projection has committed this event*, and hands the handler the
  committed projection state (`ctx.state`, already in memory — sequenced
  ≥ this event). Plain `events` fires on raw delivery with no state.
- **Filter** — `events: [...]` narrows which event types fire it. On a
  `fold`/`map` trigger it composes: "after the fold commits, but only for
  message events".

```ts
{ fold: "traceSummary", events: [SPAN_RECEIVED], … }  // sequenced + filtered
{ fold: "traceSummary", … }                            // sequenced, every event
{ events: [SPAN_RECEIVED], … }                         // raw delivery
```

Rule of thumb: **need every fact in order → `events`; need the settled
picture → `fold`** (fold/map triggers collapse per-aggregate latest-wins
inside their `ttl` window — that is their meaning, not a caveat).

## The API

### Subscriber — best-effort

```ts
.withSubscriber("evaluationTrigger", {
  fold: "traceSummary",                       // sequenced behind the fold
  events: [SPAN_RECEIVED_EVENT_TYPE],         // only message events
  when: (event) => isRelevant(event),         // pure pre-enqueue guard (perf)
  delay: 1_500,
  handler: async (event, { tenantId, aggregateId, state }) => {
    // `state` = the committed traceSummary fold, ≥ this event.
  },
})
```

Retry is queue redelivery; dedup/debounce are options; a lost trigger is
lost. Use only where the next event heals everything or losing one is
harmless (broadcasts, mirrors into ReplacingMergeTrees, latency
optimizations over a durable path).

### Process manager — promised

Defined in the domain as one config object; mounted on its pipeline.

```ts
export const triggerSettlementPM = (deps: DispatchDeps) =>
  defineProcessManager<SettlementState, SettlementFacts>({
    name: "triggerSettlement",
    state: INITIAL_STATE,
    triggers: [{
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      feed: matchFeed,      // (event, ctx) => [{ key: triggerId, fact: "trigger-match", data }]
    }],
    on: {
      "trigger-match": (state, data, { at, key, intents }) => ({
        state: …, nextWakeAt: …, intents: […],       // pure — no I/O, no clock
      }),
      wake: (state, scheduledFor, { intents }) => ({ … }),
    },
    intents: {
      "notify-digest": { schema: notifyDigestSchema, run: sendDigest(deps) },
      "persist-match": { schema: persistSchema,      run: persistMatch(deps) },
    },
    outbox: { maxAttempts: 8, leaseDurationMs: 120_000 },
  });

// pipeline file:
.withProcessManager(triggerSettlementPM(deps.automations.dispatch))
```

Singleton sweeps declare `schedule: { everyMs: 30_000 }` — the runtime keeps
the instance armed so `on.wake` fires on cadence with no events at all.

Cross-pipeline input is not a new concept: a plain subscriber on the other
pipeline calls the process manager's fact port
(`processRuntime.publishFacts(...)`).

### The three layers of a process manager

```
feed (impure rim)   event + projection state → facts addressed to instances
on   (pure core)    (state, fact data) → new state + nextWakeAt + intents
run  (impure rim)   executes a leased intent; throws → outbox retry
```

Facts never persist (consumed synchronously into the Postgres commit; the
queue re-runs the feed on redelivery), so they are typed by **TypeScript
alone**. Intent payloads *do* persist (outbox rows), so they carry **zod
schemas**, parsed at emit and again at dispatch.

### Type safety

- `defineProcessManager<State, Facts>` — `on` is a mapped type over
  `keyof Facts`: a fact without a handler is a compile error; handler `data`
  params are exact.
- Intents: `on` handlers can only emit via the typed factories
  (`intents["notify-digest"]({ key, payload })`) — undeclared intent types
  are unrepresentable, payloads typecheck against the schema's input type.
- `withSubscriber` on a typed pipeline infers `ctx.state` from the named
  fold/map projection; a nonexistent projection name is a build-time error.
- Everything that persists (intent payloads) is schema-validated at both
  ends; everything that doesn't (facts) is statically typed and never
  trusted across a wire.

## Old → new mapping

| Legacy | Replaced by |
|---|---|
| `.withReactor(proj, name, def)` | `.withSubscriber(name, { fold/map: proj, handler })` — same post-commit sequencing, same in-memory state (`ctx.state`), same per-aggregate collapse |
| Reactor `shouldReact` pre-enqueue guard | `when:` option |
| Reactor `makeJobId`/`ttl`/`delay` debounce | `ttl`/`delay`/`dedup` options |
| `.withOutbox(proj, name, def)` + `ReactorOutbox` + settle/cadence stage payloads + PG audit adapter | process manager: feed (match) → `on` (debounce/cadence as pure state) → intents (ProcessManagerOutbox) → `run` (dispatch) |
| `OutboxHeartbeatScheduler` + Redis leader lock (30s graph sweep) | `schedule: { everyMs }` + wake-worker revision fencing (the CAS loser stands down) |
| K8s graph-alert cron | deleted (ADR-034); sweep PM owns absence/resolve |
| `withEventSubscriber(name, def)` | `.withSubscriber(name, { events, handler })` — same thing, unified descriptor |
| Hand-rolled per-domain composition (`new ProcessManagerService/OutboxDispatcherService/ProcessOutboxWorker/ProcessWakeWorker`, Deferred wiring, `runsWorkers` gates) | the runtime owns all of it: one shared process-outbox + wake worker set per EventSourcing instance, role-gated, closed with the runtime |
| `ReactorOutbox` table | dropped — `ProcessManagerInbox/Instance/Outbox` are the ledger |

## Guarantee audit — what we had, where it lives now

| Guarantee | Legacy mechanism | Now | Status |
|---|---|---|---|
| Fold ordering: per-aggregate FIFO, stream order | GroupQueue group = aggregate | unchanged | ✔ identical |
| Reactions see state ≥ the triggering event | reactor fired post-fold with foldState | `fold`/`map` trigger: staged post-commit, `ctx.state` in hand | ✔ identical |
| Burst collapse (10k-span trace ≠ 10k reactions) | reactor jobId + ttl debounce | `ttl` collapse on fold/map triggers; `dedup` on event triggers | ✔ identical |
| Pre-enqueue rejection (don't serialize what you'll drop) | `shouldReact` | `when` | ✔ identical |
| Settle debounce + cadence digest timing (ADR-026/027) | Redis debounce TTLs + delayed jobs | pure state (`settleDueAt`/`dispatchDueAt`) + `nextWakeAt` | ✔ **stronger** — survives Redis loss; was silently droppable before |
| Notification durability: decided-once, delivered-at-least-once | GroupQueue retry + `TriggerSent` claims (+ audit shadow) | PM inbox (consume-once) + outbox lease/retry + same `TriggerSent` claims | ✔ **stronger** — decide+promise are atomic in Postgres |
| Email caps not double-burned on retry | cap slots keyed by dispatch digest | unchanged (same dedupKey scheme in `run`) | ✔ identical |
| At-most-once per (trigger, trace) send | `TriggerSent` claim-after-send | unchanged | ✔ identical |
| Graph sweep single-flight across workers | Redis leader lock | wake revision fencing (exactly one commit wins) | ✔ equivalent, one less moving part |
| No-data alerts on silent projects | 30s heartbeat scan | `schedule:` wake + same candidate discovery | ✔ identical cadence |
| Replay safety: rebuilding projections fires no side effects | subscribers/outbox skipped on replay | subscribers still not invoked on replay; PM inbox no-ops redelivered/replayed inputs | ✔ identical (map-trigger subscribers keep the deliberate map-replay participation for external mirrors) |
| Langy conversation ordering | subscriber queue keyed by conversation | unchanged (default group key) + PM advisory-lock/CAS serialization per instance | ✔ identical |
| Poison isolation | poison-group park guard | unchanged (queue-level) | ✔ identical |
| No customer content at rest in Postgres | audit-adapter redaction allow-list | structural: state/facts/intents carry ids + config only; intent schemas are the reviewable boundary; dispatch re-reads content from ClickHouse | ✔ **stronger** |
| Scenario run dispatch | fire-and-forget into in-process pool (lost-dispatch window) | `scenarioRunDispatch` PM: promised `dispatch:<runId>` intent | ✔ **fixed** (was a real gap) |
| Loss windows (honest accounting) | Redis loss ate pending settles/cadences silently | Redis loss can still eat *triggers* (subscriber jobs, PM feed jobs not yet committed) — healed by re-match/sweep/log re-drive; can never eat a committed promise | ✔ net improvement, same trigger-loss class as before |

## What each store is for (the reader taxonomy)

- **Query** (dashboards, search): any projection; eventual is fine.
- **Reaction** ("do something with state ≥ this event"): a sequenced
  `fold`/`map` trigger; never an arbitrary-time projection read.
- **Decision** (irreversible): never a projection — PM state + inbox/outbox,
  claim tables (`TriggerSent`), command dedup. Projections advise; ledgers
  decide.

The fourth, unofficial contract — *read an eventually consistent projection
at an arbitrary moment and treat it as now* — is the one that bred the old
bugs, and the API no longer has a way to express it.
