# ADR-108: The dispatch plane — a client, a producer, a consumer, and one lane

**Date:** 2026-07-30

**Status:** Accepted — supersedes ADR-100 and ADR-101. The lane descriptor and
the replay contract are kept in substance; the module count around them is not.

**Supersedes:** ADR-100 (the dispatch plane and group keys), ADR-101 (replay).

**Builds on:** ADR-107 (the pipeline this plane delivers, and the `.id()` map it
calls to name a lane).

**Related:** ADR-109 (the stores a delivery writes into, and which writes are
retryable), ADR-110 (the package boundary the ports below cross).

## Context

The engine is gone. `event-sourcing.old/` was deleted, and with it the event
store, the command bus, the GroupQueue, the process-manager runtime, replay and
the composition root — verified absent by repo-wide grep, not inferred. 267
files hold 496 dangling references and the application cannot boot. So this ADR
is not a refactor of a working plane; it is the design of the replacement.

Two things about the old plane are worth carrying, and both were correct.
ADR-100's lane descriptor — a dispatch declares `{tenantId, lane, scope}` and
never a string — fixed a real class of defect: two analytics rollups keyed one
lane per event while writing an `AggregatingMergeTree`, so the tables whose
entire purpose was to not be written per event received one insert per span.
Nothing in the type system could have caught it, because the decision was
spelled as a template literal. ADR-101's rule that replay is offline and
version-gated is likewise kept.

What is not carried is the size. The old plane was roughly sixty modules: a
twelve-file GroupQueue with hand-written Lua, two envelope formats (GQ1 and
GQ2) maintained in parallel, a tiered blob spool, a fifteen-module replay
subsystem with its own executors and drain paths, a kill-switch subsystem
threaded through the router, an introspection module, and three projection
executors for two kinds of projection. The guarantees below are the same. The
apparatus is not.

Throughput is a first-class constraint here rather than an afterthought, because
two costs are structural in the current shape:

- **The payload is parsed and re-serialised three to five times per event** —
  once decoding the request, once into the event log, once into the job body,
  once out of the job body, once more if a store re-encodes. Each pass is a
  synchronous walk over the whole payload on the event loop.
- **`ch.json()` costs a `JSON.parse` plus a full zod `safeParse` on every fold
  read-back.** That is the single most expensive thing on the hot delivery path,
  and it is paid per delivery, per fold, forever.

Neither is a tuning problem. Both are consequences of where the encoding
boundaries were drawn, which makes them this ADR's business.

## Decision

### 1. Four roles, and each has one job

```
composition root (application)
└── EventSourcingService          lifecycle: register → start → stop → health
      ├── CommandClient           the typed write surface application code calls
      ├── EventProducer           append to the event log, stage lane jobs
      ├── LaneConsumer            claim → decode → execute → settle
      └── ProcessRuntime          process-manager state, intents → outbox, wakes
```

The split is by direction of travel, not by domain. A **client** is called; a
**producer** writes and stages; a **consumer** drains and executes; the
**service** owns lifecycle and holds the registry. Nothing else is a top-level
concept, and in particular there is no separate router, no separate queue
manager, no separate introspection module — the registry *is* the introspection,
because the only questions worth asking (what is registered, what subscribes to
what, what is enabled) are answers it already holds.

Registration is unconditional and consumption is gated. Every process role
builds the same graph, so command dispatch, type surfaces and introspection are
identical everywhere; only the consumer loops start, and only where
`roleRunsWorkers` holds (ADR-110).

### 2. A lane is a descriptor, and the pipeline never sees the string

Every dispatch declares `{ tenantId, lane, scope }`.

`lane` is a discriminated pair: a kind — `fold`, `map`, `subscriber`,
`processManager`, `command`, `job` — and a name. `processManager` is a kind, not
a `pm:` prefix on a subscriber name, so the fan-out seam discriminates on a
field rather than testing a string. That also removes a reserved-prefix hazard,
where a hand-declared subscriber named `pm:*` silently inherited process-manager
handling.

`scope` is one of four:

- `aggregate` — FIFO per aggregate. The default, and mandatory for folds.
- `event` — one lane per event. Maximum parallelism, and no batch can form.
- `partition(parts: string[])` — the declared batching unit: tenant plus trace
  plus time window, or a hashed shard.
- `global` — one lane per tenant, covering every aggregate.

`parts` is a `string[]`, never a joined string. **Nothing downstream of the
descriptor concatenates**, and one renderer turns a descriptor into a Redis key.
That renderer owns separator choice, escaping of every part, and Redis Cluster
hash-tag placement — so the tag is *constructed* around the co-slotted segment
rather than scanned for afterwards. Validating a finished string can only
reject; constructing it cannot go wrong.

**A fold's lane comes from `.id()`, not from a helper.** ADR-107 decision 4
makes `.build()` return `aggregateIdFor(eventType, payload)`, and this plane
calls it. There is no `*GroupKey` function in a pipeline directory, and no way
for the lane a fold is serialised on to disagree with the row it reads back —
they are one call. The previous shape had roughly twenty such helpers, none
reachable from the declaration they duplicated.

### 3. Scope declares ordering and batching together, because they are one fact

Two jobs are ordered against each other exactly when they share a lane, and they
can coalesce exactly when they share a lane. Splitting that into separate
`ordering` and `batching` options is what let a per-event key coexist with a
batching intent that was silently dropped.

The pairing is enforced by ADR-107 decision 14's checker, at composition time,
with every input in scope because the scope is now declared at the mount.

### 4. The queue is one sorted set per lane and one atomic claim script

A lane is a Redis sorted set scored by the ordering key. Staging inserts the job
and assigns its sequence in the **same** atomic step, so a job cannot exist
without a sequence or share one with a sibling. Claiming pops the lowest-scored
member of an eligible lane, takes a lease, and marks the lane in-flight so no
second consumer can hold it.

Redis Streams were the obvious alternative and were rejected. Streams give
at-least-once, consumer groups and lease recovery natively, which is genuinely
less code — but per-lane FIFO needs a stream per lane, which is unbounded key
growth with no primitive for reclaiming an empty one, and consumer groups
provide no cross-lane fairness, so the scheduler in decision 5 would have to be
built anyway on a substrate that makes the sequence stamp harder rather than
easier. A sorted set plus one script keeps the sequence inside the insert, which
is the property `delivery-sequence.feature` actually requires.

One script, not twelve files. The old plane's Lua surface covered staging,
claiming, dedup squashing, blob leasing, blob deletion and sweeping; the spool
in decision 9 is smaller and the dedup squash is a scope decision now, so what
remains is stage, claim, settle, retry.

**The Redis key layout is a live contract, not an implementation detail.** This
is the correction that matters most about this decision, because the first
draft of it read as though the substrate were free to choose its own keys. It is
not. The operator surface — `app-layer/ops/repositories/queue.redis.repository.ts`,
`ops/queue.service.ts`, `api/routers/ops.ts` and the `GroupsCard`/`BlockedCard`
components — survived the engine's deletion and reads Redis **directly**, by key,
without going through any port:

```
<queue>:gq:ready                     zset of ready group ids
<queue>:gq:blocked                   zset of blocked groups
<queue>:gq:dlq                       zset of dead-lettered groups
<queue>:gq:stats:total-pending       the pending counter the dashboard graphs
<queue>:gq:parked-tenants            set of tenants with parked groups
<queue>:gq:parked:<tenantId>         zset of that tenant's parked groups
<queue>:gq:group:<groupId>:jobs      zset of the group's staged jobs
<queue>:gq:group:<groupId>:active    the in-flight marker
<queue>:gq:group:<groupId>:data      the group's job bodies
```

A substrate that renders different keys does not fail a test — it silently
blanks every operator view during the incident the views exist for. So the
layout above is part of this decision, and the `unblockGroup` / `drainGroup` /
`moveToDlq` operations the ops repository already implements against it stay
callable.

**An operator-recovery surface is not a kill switch.** Decision 13 shrinks the
kill switch to one predicate, and that is right — but unblocking a group,
draining it, moving it to the DLQ and reading queue depth are recovery
operations an operator performs *during* an incident, and they are neither
retired nor replaced by a boolean. They are the reason the layout is a contract.

### 5. One scheduler policy — fairness, soft caps and parking are one loop

Work-conserving fair dispatch, per-tenant soft caps and poison-group parking
were three subsystems with three spec files. They are three questions asked of
the same decision — *which lane next?* — and they collapse into one policy:

- Round-robin across tenants, so one tenant's backlog cannot starve another.
- Skip a lane that is leased, which is what makes per-lane serialisation hold.
- Skip a tenant over its in-flight soft cap, then keep going rather than idling
  — that is what "work-conserving" means, and it is a `continue`, not a
  subsystem.
- Park a lane after N consecutive failures, and surface it. A parked lane stops
  consuming its own retries without stopping its tenant.

**Two things this decision got wrong, both found by trying to wire it up.**

First, **a pure policy is easy to test and easy to leave unreachable.**
`LaneQueue.claim(request)` returns whichever lane the substrate picked, and
`ClaimRequest` carries no lane, so a consumer cannot ask for the lane a policy
chose. `selectLane` was therefore written, tested, and called by nothing —
round-robin fairness and the tenant soft cap were enforced nowhere while a
first-eligible scan decided the order. Only `parkAfterFailures` was live,
because the consumer applies it after the fact. A green suite said nothing about
whether anything called it.

Second, **the in-flight counts have to be shared, or the cap is per-process.**
If each consumer counts only its own leased lanes, N pods each admit up to the
cap and the effective cap is N times the configured one — which is not a cap.
The old plane kept per-tenant in-flight *slots* in Redis for exactly this
reason, and retiring that as "storage mechanics" removed the thing that made the
cap real.

**How this resolved: the substrate owns the policy, not the consumer.** The
tenant cap lives in the Redis queue as a per-tenant in-flight sorted set whose
member is the lane and whose score is that lane's own lease expiry — so a worker
that dies mid-job ages out of its tenant's count with no cleanup path, the same
way its lane lease does, and `settle`/`retry`/`park` release the slot
immediately rather than waiting out the lease. A tenant at its cap has its
remaining lanes skipped while the scan continues, which is what work-conserving
means. Cross-lane rotation is the same scan starting from a rotating offset
rather than from the front.

That leaves `selectLane` with nothing to do, and the honest conclusion is that
extracting the policy into a pure function was the wrong move: it read as
progress, tested cleanly, and enforced nothing. One policy, in the place that
holds the counts, is the design — a second copy in process memory could only
disagree with it.

The policy is one function over the lane index. It is testable without Redis,
because it decides from counters rather than from I/O.

### 6. A job is a compact header plus an opaque body

The header carries what routing, scheduling and observability need: tenant,
lane kind and name, scope parts, aggregate id, event type, sequence, attempt,
cost in bytes, and a blob reference if the body was offloaded. The body is
bytes and is never inspected by the plane.

This is a throughput decision and a contract at once. `delivery-sequence.feature`
already requires that a job's sequence be readable "without decoding the job's
body"; making the header a separate, fixed, cheap-to-read segment satisfies that
by construction instead of by care. The scheduler, the metrics and the parked-
lane report all read headers only, so a 4 MiB body costs nothing until the
consumer that will actually use it decodes it.

There is **one** envelope format. The old plane maintained two, GQ1 and GQ2,
with parallel decode paths and a spec scenario asserting the sequence survived
both. The queue is transient — nothing in it outlives a restart by design — so
no migration is owed and no second format needs to exist.

### 7. The payload is encoded once

A command serialises its event payload exactly once, at the trust boundary
(ADR-107 decision 15), and **that same string** is what reaches
`event_log.EventPayload`, the job body, and replay. No stage re-encodes, and no
stage decodes a payload it does not read.

Three rules make it hold:

- **A handler decodes only its own event's schema**, through the compiled-schema
  cache. A fold never pays for a sibling event's payload.
- **A fold's state stays a decoded object in the hot tier**, and is serialised
  only at the durable boundary. The in-process tier is keyed by lane *and lease
  generation*, so a lane migrating to another pod invalidates rather than
  serving state that pod has since advanced. Redis is the shared warm tier below
  it, and pays serialisation because it must.
- **Everything stays a ClickHouse `String`.** There is no ClickHouse JSON type
  in use; `ch.json()` is a `String` plus a codec. So encoding once is a change
  to *when* we serialise, never to what is stored, and no migration is owed.

The measurement this targets is three to five passes per event becoming one.

### 8. Coalescing follows from the scope, and is bounded by bytes as well as count

Coalescing a fold is a pure left-fold: the final state is identical to applying
the events one at a time, so raising the bound changes throughput only. That is
safe because ADR-107 requires the fold to be order-invariant, not because
delivery happens to arrive in order.

A batch is bounded by count **and** by bytes — 4 MiB by default. A count-only
bound lets 500 large events coalesce into a batch no consumer can hold, which is
how a fat lane becomes a stalled loop. Consumers additionally bound their own
in-flight work, so one oversized batch cannot occupy the whole pool.

A map coalesces when its scope admits a batch and its store implements a bulk
write; declaring a batching scope without one is a mount-time error rather than
a silent per-row insert. One write per event is one part per event in a column
store, and that shape has already taken a table down.

**A coalesced apply produces one emission, not N.** A process manager folding a
batch writes one set of outbox intents, because the rows are minted from the
resulting state rather than per input event. Where N distinct effects are
genuinely required — one command per item, one webhook per match — the lane
declares `scope: event` and accepts that it can never batch.

### 9. Payload cost is a scheduling input, denominated in bytes

Cost is extracted once, while the committed event is already in memory, and
travels in the header. Three seams consume it.

**The enqueue filter.** A total, cheap predicate decides whether a job is minted
at all — the cheapest job is the one that never exists. The seam takes only
*total* predicates, because the routing path has no retry: a throw there loses
that `(subscriber, event)` job permanently. Anything fallible belongs in the
consumer's own lane, where a failure retries one job.

**Reference staging.** A hook swaps a staged payload for a small reference that
mirrors the source event's scheduling identity, so a lane's depth is denominated
in references rather than payload bytes. A reference the seam cannot build stages
the whole event, so the consumer understands both shapes.

**The spool.** An oversized body is offloaded to a content-addressed,
tenant-namespaced store, with the tenant segment branded so a caller cannot pass
a raw user-controlled string. Small payloads live in Redis and large ones in the
durable object store, with a hard ceiling.

### 10. The spool is transient; an event's referent is not

A spooled body is reclaimable once the jobs holding it complete. An event may
also carry a durable *reference* to a payload stored elsewhere (ADR-107), and
that referent must outlive the event's retention, measured in weeks.

These are separate stores with separate lifetimes and separate key spaces, and
the reason is not tidiness: reclaiming a blob because its job finished, while an
event still references it, is silent permanent data loss discovered only on
read. **A reference-carrying event never points into the spool.**

### 11. A process manager is durable, and its intents leave through an outbox

One pure step — `evolve(state, input) → { state, nextWakeAt, intents }` —
identified by `(processName, projectId, processKey)`, with persistence,
revision and idempotency behind a store port. `nextWakeAt` is required: `null`
clears the deadline, a number replaces it, and "leave it alone" is spelled by
returning the same number, never by omitting the field.

An intent is staged into the outbox in the same transaction as the state it was
minted from, then dispatched separately with its own attempt budget.

**That first clause is currently false, and the gap is worth naming rather than
restating as an aspiration.** The runtime persists state and stages intents as
two independent calls through two ports, so a crash between them loses that
delivery's intents permanently — state has already advanced past the transition
that would have re-derived them, and nothing replays a process manager. The
ports as declared cannot fix it: `ProcessStore` and `Outbox` are separate
interfaces with separate implementations, and a transaction spanning both is not
expressible through either. Closing it means one port that owns both writes, or
a transaction handle threaded through both — a contract change, not an
implementation detail. Until then the honest description is at-least-once state
with best-effort intents, and the failure window is one process crash wide. Delivery
failure is classified: a retryable failure schedules a backoff, a terminal one
surfaces the row to an operator. An endpoint that fails must *throw* a
classified error rather than logging and returning as if nothing happened —
otherwise the outbox cannot tell success from silence.

Ordering inside an intent handler is durable-write-last-that-can-fail:
best-effort signals first, then the durable write, which is the only step
allowed to fail the intent and be retried, then cache updates whose failure is
swallowed. A terminal write that succeeded while a cache update failed is
correct; the reverse is not.

Wakes are polled from the store by deadline, and a scheduled wake's intent key
is derived from the scheduled instant carried on its payload, never from the
clock at step time (ADR-107 decision 16).

### 12. Replay is one function, offline, and version-gated

Replay reads `event_log` for an aggregate or a bounded tenant range and re-runs
**the same executors the delivery path uses**. It is the sole bulk reader of the
log, it never runs subscribers, and it is gated on the fold's state version so a
replay cannot write rows a current build could not have written.

It builds the same lane descriptors through the same renderer, so lane names are
a function call rather than an agreement — the old plane documented its fold lane
format in a comment and re-derived that literal in a second module, which is a
rename away from a drain that silently misses.

Fifteen modules with their own executors and drain paths become one function
plus the executors that already exist. There is no second projection code path
to keep in agreement with the first, which is the actual cost the old shape was
paying.

### 13. Ports, and what is deliberately not one

Contracts live in the package; implementations live outside it (ADR-110), so the
purity test keeps holding.

| port | what it does |
| --- | --- |
| `EventLog` | append committed events; scan a bounded range for replay |
| `LaneQueue` | stage, claim, settle, retry, park |
| `BlobSpool` | put, get, release |
| `ProcessStore` | load, save, due-by-deadline |
| `Outbox` | stage, claim, settle, fail |
| `Clock`, `Metrics`, `Tracing` | the ambient capabilities every member observes through |

A **kill switch is not a port and not a subsystem.** It is one predicate,
`enabled(lane)`, consulted by the consumer before it claims. The old plane
threaded a kill-switch module through the router and the queue and gave it its
own registry; what an operator needs is the ability to stop one lane during an
incident, and that is a boolean.

### 14. Worker threads are deferred, and the seam is named

Moving CPU-bound work off the loop with `worker_threads` was considered and is
not adopted now, for reasons worth recording so the option is re-opened on
evidence rather than on instinct.

`postMessage` uses structured clone, which for a live object graph is itself a
full serialisation pass — often as costly as the `JSON.parse` it was meant to
avoid. Threads therefore only pay when handed **transferable bytes**. That rules
out the folds and maps, which operate on decoded object graphs, and would make
wrapping them a straight regression.

The one genuine candidate is the ingest codec: bytes in, canonical payload
string out. It is CPU-heavy, it receives a buffer that can be transferred
zero-copy, and it can have a tiny dependency graph. So it is written as a pure
function over `Uint8Array` with no application imports, which makes moving it
behind a pool later mechanical rather than a redesign.

Two reasons to wait. Decision 7 *removes* three to five passes per event rather
than relocating one, and may make threads unnecessary. And this system already
scales off the web event loop with processes, not threads — threads inside the
worker process are a second layer of the same idea, worth adding only once one
worker process is CPU-saturated on a single core, measured by event-loop lag.
There is also local precedent for the hazard: a worker tier here once died on
14–28 seconds of module load per worker, so any pool must keep a minimal graph.

## Rationale / Trade-offs

**Why merge the dispatch plane and replay into one ADR?** Because replay's whole
correctness argument is that it reconstructs the same lanes and runs the same
executors as the delivery path. Stated in a separate document, that agreement is
prose; stated here, it is one renderer and one executor with two callers.

**Why a sorted set rather than Redis Streams?** The sequence stamp has to be
assigned inside the same atomic operation that inserts the job. A sorted set
plus one script does that directly. Streams would give at-least-once for free
and then take back more than they gave: a stream per lane is unbounded key
growth, and consumer groups have no fairness primitive, so the scheduler is
still ours to write.

**Why is the header/body split worth a custom envelope?** Because the scheduler
touches every job and needs six small fields from it. Parsing a 4 MiB body to
read a sequence number is the difference between a scheduler whose cost is
constant per job and one whose cost is proportional to payload size — and the
spec already required the sequence to be readable without the body, which no
single-blob format can honour.

**Why does encoding once matter more than the serialisation format?** Because
the format is already good: inserts are positional `JSONCompactEachRow`, so
column names are not repeated per row. The waste is not in how we encode, it is
in how many times. Switching to a binary wire format would be a large change for
a smaller win, and would break the read path's format in the same move.

**Why one scheduler function instead of three tuned subsystems?** Because all
three answered the same question and could disagree. A soft cap that skips a
tenant, a fairness pass that selects one, and a park list that excludes one are
three filters over one candidate set; implemented apart, the interaction between
them is emergent and untestable without Redis.

**What this costs.** A descriptor allocation and an escape pass per dispatch,
where the old shape had one template literal. On the routing path that is
measurable, and it is the price of the invariant — bounded by the same fan-out
the string version paid.

## Consequences

- **Roughly sixty modules become the eight in decision 1 plus six ports.** The
  guarantees are unchanged: per-lane FIFO, at-least-once, coalescing, byte
  bounds, offload, durable process state, version-gated replay.
- **The payload is serialised once per event** instead of three to five times,
  and a fold's read-back stops paying `JSON.parse` plus a full zod validate on
  every delivery.
- **The scheduler's cost becomes constant per job**, because it reads headers.
- **One envelope format**, so the parallel decode path and the scenario
  asserting both formats' behaviour both go.
- **Replay stops being a second implementation of projection execution.** The
  class of defect where a drain reconstructs a lane name by convention and
  misses after a rename cannot occur.
- **A kill switch shrinks from a subsystem to a predicate**, which is all the
  ops page ever needed.
- **`serializeByAggregate` disappears as an option**; its call sites declare
  `scope: aggregate`, and the registration-time warning that only logged the
  contradiction is deleted because the contradiction is no longer expressible.
- **Worker threads remain available and unbuilt**, with the ingest codec written
  so adopting them is a wiring change.
- The spool and the durable event-reference store stay separate, which costs a
  second store to operate. Sharing one would be cheaper and would eventually
  delete a referenced payload.

## References

- `packages/event-sourcing/src/dispatch/groupKey.ts` — decision 2's renderer.
- `packages/event-sourcing/src/runtime/` — decisions 1, 4, 5, 6, 11, 12.
- `specs/event-sourcing/dispatch-plane.feature` — the lane, scope and coalescing
  contract.
- `specs/event-sourcing/job-identity.feature` — the header, the sequence, and
  what survives a retry.
- `specs/event-sourcing/dispatch-durability-and-fairness.feature` — decision 5.
- `specs/event-sourcing/payload-cost-and-spool.feature` — decisions 9 and 10.
- `specs/event-sourcing/process-manager.feature` — decision 11.
- `specs/event-sourcing/replay.feature` — decision 12.
- ADR-107, ADR-109, ADR-110.
