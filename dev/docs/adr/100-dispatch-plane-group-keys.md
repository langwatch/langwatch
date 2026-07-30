# ADR-100: The dispatch plane — a group key is a declared contract, not a string

**Date:** 2026-07-29

**Status:** Superseded by [ADR-108](./108-the-dispatch-plane.md) (2026-07-30). Previously: Accepted — the descriptor is the only way to name a lane; the
mispaired scopes named below are corrected as part of adopting it.

**Builds on:** ADR-098 (the projection kinds and post-event work this plane
delivers, and the durable-reference rule the job spool must not be confused
with).

**Related:** ADR-099 (the tables a coalesced batch writes into, and the merge
strategy that decides whether a batch may be retried), ADR-101 (replay, which
reconstructs lane names to drain them), ADR-103 (the run process manager whose
lanes this plane keys).

## Context

Every unit of post-event work in the pipeline is dispatched through one
GroupQueue, which provides best-effort per-group FIFO with cross-group
parallelism
(`langwatch/src/server/event-sourcing/queues/groupQueue/groupQueue.ts:246`).
Which group a job lands in — and therefore what is ordered against what, and
what may be batched with what — is decided by a single string.

That string is assembled here:

```ts
return (payload: any) =>
  `${getTenantId(payload)}/${jobPath}/${domainKeyFn(payload)}`;
```

`langwatch/src/server/event-sourcing/services/queues/queueManager.ts:157-158`.
All three inputs are `any`-typed functions (`:150-155`), and `jobPath` is itself
built by concatenation at each mount point: `"map"` at `:291`, `"subscriber"` at
`:308`, `` `${jobPath}/${handlerName}` `` at `:346`, ``
`${lane.jobPath}/${projectionName}` `` at `:429`, `"command"` or ``
`command/${cmdName}` `` at `:594`, and `` `job/${name}` `` at `:828`. A process
manager has no lane of its own at all: it rides the subscriber lane under a
name prefix, `` `pm:${processName}` ``
(`process-manager/subscriberName.ts:19-24`).

Three consequences follow from that shape, and all three are live.

**The key is duplicated as prose.** `replay/replayDrain.ts:12` documents
"Fold groupIds are always
`` `${tenantId}/fold/${name}/${aggregateType}:${aggregateId}` ``" and `:26`
re-derives exactly that literal so replay can drain the lane; `:49` scans a
prefix for the lanes it cannot reconstruct. The renderer and the reader agree by
comment. Separately, the deduplication key for the same job uses `:` where the
group key uses `/` (`queues/queue.types.ts:61`, and the `groupKey` example at
`:195` uses `:` for all three segments), so two hand-written conventions for the
same identity coexist in one file.

**Escaping and Redis Cluster placement are validated, never constructed.**
`hasRedisHashTag` scans a finished string with `indexOf`
(`queues/groupQueue/redisHashTag.ts:8-13`), and the only production caller
throws when a cluster-mode queue name lacks a tag
(`queues/groupQueue/envelopeBlobLifecycle.ts:67`). Nothing prevents a domain key
from containing the `/` separator; the `parts` that make up a domain key are
already concatenated by hand at each site, for example ``
`experiment:${experimentId}:result:${runId}:item:${index}` ``
(`pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection.ts:69-72`).

**The granularity that decides ordering and batching is invisible.** Seven map
projections key one lane per event — `` `span:${event.id}` ``
(`pipelines/trace-processing/projections/spanStorage.mapProjection.ts:41`), ``
`rollup:${event.id}` ``
(`pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection.ts:99`),
`` `evalRollup:${event.id}` ``
(`pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.mapProjection.ts:154`),
`` `billing:${event.id}` `` (`projections/global/orgBillableEventsMeter.mapProjection.ts:53`),
and the three governance projections at
`ee/governance/projections/governanceKpis.mapProjection.ts:178`,
`governanceOcsfEvents.mapProjection.ts:220` and
`gatewayBudgetDebits.mapProjection.ts:270`. Two subscribers key one lane per
tenant for every event, via a shared constant
(`pipelines/trace-processing/subscribers/_ingestSignals.ts:178`, used at
`projectMetadata.subscriber.ts:71` and `topicClusteringBootstrap.subscriber.ts:92`).
Four key a hashed shard — `` `metric-map:${lane}` ``
(`pipelines/metric-processing/canonical/shards.ts:44-54`) and `` `log:${lane}` ``
(`pipelines/log-processing/canonicalLog.ts:644-651`). Every one of those is the
same type.

The two analytics rollups are the case that matters. Both exist specifically to
collapse per-event work into pre-aggregated buckets, and both write an
`AggregatingMergeTree`
(`clickhouse/migrations/00038_create_trace_analytics_rollup.sql:108`,
`00040_create_evaluation_analytics_rollup.sql:115`). Both are keyed one lane per
event, so no two of their jobs can ever coalesce; neither declares
`coalesceMaxBatch`; and their shared store implements only `append`, which issues
one `insertRow` per record
(`pipelines/shared/analyticsStoreBase.ts:64-69`). The result is one insert per
span, and one insert per evaluation, into the tables whose entire purpose is to
not be written per event. Nothing in the type system, the router, or a review
could have caught it, because the decision was spelled as a string.

## Decision

### 1. A group key is a descriptor, and the pipeline never sees the string

Every dispatch declares `{ tenantId, lane, scope }`.

`lane` is a discriminated pair: a kind — `fold`, `map`, `subscriber`,
`processManager`, `command`, `job` — and a name. `processManager` is a kind, not
a `pm:` prefix on a subscriber name, so the fan-out seam discriminates on a field
instead of a string test.

`scope` is one of four:

- `aggregate` — FIFO per aggregate. The default.
- `event` — one lane per event. Maximum parallelism, and no batch can ever form.
- `partition(parts: string[])` — the declared batching unit, for example tenant +
  trace + time window, or a hashed shard.
- `global` — one lane per tenant covering every aggregate.

`parts` is a `string[]`, not a joined string. Nothing downstream of the
descriptor concatenates.

### 2. `scope` declares ordering and batching together, and the library enforces the pairing

The pairing is checked at mount time, and a contradiction is a
`ConfigurationError`, not a silently ignored option:

- **A `fold` lane requires `scope: aggregate`.** Two concurrent applies to one
  aggregate produce a lost update that no read-time dedup recovers; `scope:
  aggregate` is the mutual-exclusion guarantee that rules that out, stated as a
  type rather than as a convention every fold author is trusted to keep.
  Delivery order within the lane is best effort, not a guarantee — what makes a
  fold safe under reordering is that ADR-098 requires every fold to be
  order-invariant, a separate property with a separate justification.
- **`scope: event` cannot batch.** Declaring it together with a coalescing batch
  size above 1 is rejected. The two statements contradict each other, and the
  current code resolves the contradiction by quietly honouring the key and
  dropping the batch.
- **`scope: partition(parts)` is the batching unit.** Jobs sharing all parts
  coalesce; jobs differing in any part run in parallel. The metric and log map
  projections are already exactly this — a hashed shard key plus
  `coalesceMaxBatch: 256`
  (`pipelines/metric-processing/schemas/constants.ts:18`,
  `pipelines/log-processing/schemas/constants.ts:20`) — and they are the pattern
  the two rollups adopt.
- **`scope: global` must be written out.** It serialises a tenant's entire
  stream through one lane. That is correct for the two ingest-signal subscribers,
  whose per-project deduplication needs a lane to collapse into
  (`_ingestSignals.ts:168-176`), and it is wrong almost everywhere else. Spelling
  it makes the difference reviewable.

### 3. Rendering, escaping and hash-tag placement happen in one function

One renderer turns a descriptor into a Redis group id. It owns separator choice,
escaping of every `parts` element, and Redis Cluster hash-tag placement — so the
tag is *constructed* around the co-slotted segment rather than scanned for
afterwards, and `hasRedisHashTag`'s `indexOf` check becomes an assertion about
the renderer's own output rather than a guard against arbitrary caller strings.

Replay does not reconstruct lane names from prose. It builds the same descriptor
and calls the same renderer, which retires the comment-enforced agreement at
`replay/replayDrain.ts:12`. The deduplication key is derived from the same
descriptor, so the `/`-vs-`:` divergence between `queueManager.ts:158` and
`queue.types.ts:61` cannot recur.

### 4. Coalescing follows from the scope, and it collapses emissions

Folds coalesce by default, up to `DEFAULT_FOLD_COALESCE_MAX_BATCH = 500`
(`projections/projectionRouter.ts:62`, applied at `:410-411`). The router's own
justification is the reason this is safe and stays:

> Coalescing is a pure left-fold: the final state is identical to applying the
> events one at a time (see initializeFoldQueues below), so raising it changes
> throughput only, never correctness.

`projections/projectionRouter.ts:58-60`. A coalesced batch is ordered by the
fold's declared comparator before application
(`projections/foldProjectionExecutor.ts:490-494`) rather than by arrival
order — coalescing is safe because the fold is order-invariant (ADR-098), not
because delivery happens to arrive FIFO.

Maps coalesce when their scope admits a batch — `aggregate`, `partition`, or
`global` — and their store implements `bulkAppend`
(`projections/mapProjection.types.ts:145`), whose context is deliberately
tenant-scoped because a bulk write "batches records from MANY aggregates of one
tenant into a single insert" (`:112-119`). The live path already takes it
(`projections/mapProjectionExecutor.ts:88-99`); it is unused by the rollups only
because their key forbids a batch and their store never implements it. Under the
descriptor, a map declaring a batching scope without a `bulkAppend` store is a
mount-time error, not a silent per-row insert.

**A coalesced apply produces one emission, not N.** A process manager folding a
batch of events writes one set of outbox intents, because the outbox rows are
minted from the resulting state, not per input event. Where N distinct downstream
effects are required — one command per event, one webhook per match — the lane
declares `scope: event` and accepts that it can never batch. That is the honest
trade, and making it a declared scope is what forces it to be made deliberately.

Command lanes carry the same pairing. `serializeByAggregate`
(`pipeline/staticBuilder.types.ts:49`) is what switches the command lane from ``
command/${cmdName} `` to `command` (`queueManager.ts:594-604`), which is the
re-key that puts *all* of an aggregate's commands in one lane instead of running
different command types for one aggregate concurrently. Four production sites
opt in — `pipelines/evaluation-processing/pipeline.ts:165`, `:174`, `:177` and
`pipelines/automations/pipeline.ts:37`. Under the descriptor the option
disappears: a command lane declares `scope: aggregate` and the name is not part
of the lane identity. The registration-time warning that today only *logs* a
serialised producer without coalescing (`queueManager.ts:609-621`) becomes an
enforced pairing.

### 5. Payload cost is a scheduling input, denominated in bytes

Cost is extracted once, at ingest, while the committed event is already in
memory, and it travels with the job. Three seams consume it.

**The enqueue filter.** A total, cheap predicate decides whether a job is minted
at all — the cheapest job is the one that never exists
(`subscribers/eventSubscriber.types.ts:44`). Seven subscribers use it today. The
seam takes only total predicates because the routing path has no retry: a throw
loses that `(subscriber, event)` job permanently
(`subscribers/eventSubscriber.types.ts:11-31`). Anything fallible belongs in the
consumer's own lane, where a failure retries one job.

**Reference staging.** A `stage` hook swaps the staged payload for a small
reference that mirrors the source event's scheduling identity
(`subscribers/eventSubscriber.types.ts:67`), so a lane's queue depth is not
denominated in payload bytes.

**Byte-bounded batches.** A coalesced batch is bounded by bytes as well as by
count: `DEFAULT_COALESCE_MAX_BYTES = 4 MiB`
(`queues/groupQueue/groupQueue.ts:150`, resolved per job at `:930`), overridable
per producer (`queues/queue.types.ts:163`). A count-only bound lets 500 large
events coalesce into a batch no consumer can hold.

### 6. The job-payload spool is transient, and an event's referent is not

An oversized job payload is offloaded to a content-addressed, tenant-namespaced,
tiered store. The content id is `` `${projectId}/${hash}` ``
(`queues/groupQueue/blobKeys.ts:17-25`), the tenant segment branded so a caller
cannot pass a raw user-controlled string. Payloads at or below 256 KiB live in
Redis and larger ones in the durable object store, the boundary derived from
`COMMAND_INLINE_THRESHOLD` (`queues/groupQueue/tieredBlobStore.ts:39`,
`app-layer/traces/lean-for-projection.ts:32`) so a retune moves both tiers
together; a hard ceiling of 50 MiB applies
(`queues/groupQueue/blobConstants.ts:98`).

A spooled blob is reclaimable. Its lifetime is the set of jobs holding a lease on
it; when the last lease is released the blob goes onto a 1-hour grace window
before reclamation (`queues/groupQueue/blobConstants.ts:55`,
`queues/groupQueue/envelopeBlobLifecycle.ts:237-291`), with a TTL backstop for
the worker that dies before releasing.

**This is not the durable reference an event may carry.** ADR-098 permits an
event to name a payload held elsewhere instead of carrying it inline; that
referent must outlive the event's retention, which is measured in weeks or
months. A job blob's referent must not. The two are separate stores with separate
lifetimes and separate key spaces, and the reason is not tidiness: reclaiming a
blob because its job completed, when an event still references it, is silent
permanent data loss discovered only on read. A reference-carrying event never
points into the spool.

## Rationale / Trade-offs

**Why a descriptor rather than a documented string convention?** The convention
already exists and is already written down — in a comment
(`replay/replayDrain.ts:12`), in a JSDoc example (`queue.types.ts:195`), and in
two different separator styles. Three reasons, in order of how much they matter.
First, the mispaired rollups are not a lapse anyone could have caught: a
per-event key and a batching table read identically at the call site, and the
review that would have caught it has no artefact to look at. Second, the
descriptor makes replay's lane reconstruction a function call instead of an
agreement, which is the difference between a drain that is correct and one that
is correct until someone renames a segment. Third, escaping and cluster
placement are properties of the rendering, and validating a finished string can
only reject, never fix.

**Why is `scope` one field rather than separate `ordering` and `batching`
fields?** Because they are the same fact. Two jobs are ordered against each other
exactly when they share a lane, and they can coalesce exactly when they share a
lane. Splitting them into two options invites the pairing the rollups already
have — a key that forbids batching, alongside a batching intent that is silently
dropped.

**Why not simply set `coalesceMaxBatch` on the rollups and leave the keys
alone?** It would do nothing. Coalescing folds *same-group* jobs
(`queues/queue.types.ts:59-70`); with one lane per event there are no siblings to
fold. The key is the defect, and the batch size is the symptom that would have
made it visible.

**Why does `fold` require `scope: aggregate` rather than merely defaulting to
it?** A fold's accumulator lives in the row (ADR-098), so two concurrent applies
to one aggregate produce a lost update that no read-time dedup recovers. A
default can be overridden by a caller who has a reason; here there is no valid
reason, so the type refuses instead of the default yielding.

**Why keep `scope: event` at all?** Some work genuinely must emit once per event
— a webhook per match, a command per item. Deleting the option would push those
lanes into a batching scope and lose emissions. Naming it, and making it exclude
batching, is what turns an accident into a declaration.

## Consequences

- The two analytics rollups stop issuing one `AggregatingMergeTree` insert per
  event. Their lanes become `partition`, and their store gains `bulkAppend`. This
  was the largest single source of small-part pressure on those two tables, and
  it was invisible in every dashboard that measures inserts rather than events.
- `spanStorage` and the three governance map projections must each state a scope
  deliberately. Some will stay `event` — per-record independence is a real
  property — but the choice becomes reviewable rather than inherited.
- `serializeByAggregate` is removed as an option. Its four call sites declare
  `scope: aggregate` instead. The registration-time log that reported a
  serialised producer without coalescing
  (`queueManager.ts:609-621`) is deleted, because the pairing it warned about is
  no longer expressible.
- `map` + `merge` gets a second guard. ADR-098 requires that combination to
  declare an idempotency story; a `partition` scope now also means a redelivered
  batch member is a batch-level, not row-level, concern. The existing
  `dedupeByIdempotencyKey` path
  (`projections/mapProjection.types.ts:88-109`) remains the mechanism, and it
  still costs one event-log read per keyed event, so it stays restricted to
  low-volume streams.
- Every group key gains a rendering cost it did not have — a descriptor
  allocation and an escape pass per dispatch, instead of one template literal.
  On the routing path that is measurable, and it is accepted: it is the price of
  the invariant, and it is bounded by the same fan-out the string version paid.
- Replay's prefix scan for lanes it cannot reconstruct
  (`replay/replayDrain.ts:31-49`) narrows. Fold lanes were already
  exactly-reconstructible; map and subscriber lanes with a declared `partition`
  become so too, leaving the scan only for `event`-scoped lanes, whose ids depend
  on data replay has not read yet.
- `processManager` becomes a lane kind, so the fan-out seam no longer tests a
  name prefix to decide whether a kill switch applies
  (`process-manager/subscriberName.ts:16-18`). The reserved-prefix hazard — a
  hand-declared subscriber named `pm:*` silently opting out of the kill switch —
  stops existing.
- The spool and the durable event-reference store are separate by construction,
  which costs a second store to operate. Sharing one store and one reclamation
  policy would be cheaper and would eventually delete a referenced payload.

## References

- ADR-098 — the event-sourcing core: projection kinds, post-event work,
  durable reference events.
- ADR-099 — projection storage; the merge strategy that decides whether a
  coalesced batch's insert may be retried.
- ADR-101 — replay; the only path that batches across aggregates today.
- ADR-103 — runs; the process manager whose lanes this plane keys.
- `specs/event-sourcing/payload-cost.feature` — the enqueue-seam contract.
- `specs/event-sourcing/fold-coalescing.feature`,
  `producer-append-coalescing.feature` — coalescing behaviour.
- `specs/event-sourcing/span-command-sharding.feature` — the hashed-shard
  partition scope in production.
- `specs/event-sourcing/work-conserving-fair-dispatch.feature`,
  `tenant-soft-cap.feature` — cross-lane fairness.
- `specs/event-sourcing/payload-store-content-addressed.feature`,
  `payload-store-blob-hardening.feature`, `large-trace-blob-offload.feature` —
  the transient spool.
