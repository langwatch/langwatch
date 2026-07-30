# ADR-098: The event-sourcing core — commands, events, and the two kinds of projection

**Date:** 2026-07-29

**Status:** Accepted — the taxonomy and the read-outcome rule are in force.
Two moves are sequenced behind conditions that take a release cycle to clear —
one behind data ageing, one behind per-adopter redesign — and are named under
"Migration order".

**Related:** ADR-099 (projection storage — the three store kinds and
`defineTable`, which the projection kinds below mount onto), ADR-100 (the
dispatch plane that carries every delivery this ADR orders, and owns the
transient job spool), ADR-101 (replay — the only permitted bulk reader of
`event_log`), ADR-102 (where the core lives as a package and where pipelines
compose it), ADR-103 (runs — the worked example of a fold retired into a query
and an execution process manager), ADR-104 (the ClickHouse client every store
here reaches through).

## Context

A pipeline is a named aggregate type, an event union, and a set of things
mounted on it. The mounting surface is `StaticPipelineBuilder`, and it offers 3
places to put a projection:

- `withFoldProjection` (`langwatch/src/server/event-sourcing/pipeline/staticBuilder.ts:148`)
- `withMapProjection` (`staticBuilder.ts:181`)
- `withProjection` (`staticBuilder.ts:212`)

Each keeps its own registry (`staticBuilder.ts:104`, `:111`, `:118`), and each
gets its own executor. Production mounts 7 folds, 16 maps and 6 of the third
kind.

**The third kind is a fold.** Its store is a `load()`/`store()` pair
(`projections/stateProjection.types.ts:27-37`) — read prior state, apply, write
back, which is the definition of an accumulator in the row. Its own docblock
concedes the point:

> It is mechanically a fold, but deliberately has a narrower contract than a
> ClickHouse fold: direct store load/apply/store, no event-log recovery read,
> no Redis cache hook, and no projection-attached outbox.

Every clause after the comma is a *capability the other fold has and this one
declines*. A narrower contract is a configuration of a kind, not a kind. A
third registry, a third executor
(`projections/stateProjectionExecutor.ts`, 115 lines) and a third replay path
(`replay/replayStatePath.ts`) exist to express "a fold whose store is a
Postgres row".

**The refold mechanism argues against itself.** `refoldOnStoreMiss`
(`projections/foldProjection.types.ts:209`) replays an aggregate's whole
history from `event_log` when the store reads back nothing. Its own
documentation says what that costs:

> A re-fold scans the aggregate's whole history in `event_log` with no time
> bound, walking cold partitions. […] as a steady-state continuity mechanism it
> makes every cache miss pay for the entire history.

It then describes a class of aggregate for which the miss is not transient at
all — a store that declines to write a row, or writes one the read window
cannot find, misses on *every* delivery, so the option's counter "never goes
quiet" (`foldProjection.types.ts:196-201`). Two adopters document exactly such
a class (`pipelines/trace-processing/projections/traceSummary.foldProjection.ts:482-487`).
A mechanism that must never fire in steady state, cannot be removed because for
some aggregates it always fires, and is guarded at runtime by two separate
assertions (`projections/foldProjectionExecutor.ts:679`, `:706`) is not a
safety net. It is a second, unbounded read path bolted to the delivery path.

**The ordering apparatus repairs a disorder it cannot see the source of.**
GroupQueue is "per-group FIFO with cross-group parallelism"
(`queues/groupQueue/groupQueue.ts:245-252`), and a fold's group is
`${tenantId}/fold/${projectionName}/${aggregateType}:${aggregateId}`
(`services/queues/queueManager.ts:428-441` composed through
`buildGroupKey` at `:142-158`), scored by `occurredAt` (`:439-441`). That orders
the events queued at any one moment; it does not order an event that arrives
after a lower-scored sibling was already popped. Nor could any queue discipline
help: telemetry and scenario events are stamped in a customer's process and
cross a network, so the stream is unordered before we receive it. Yet
`refoldOnOutOfOrder`
(`foldProjection.types.ts:230`) defaults to *replaying the whole history* when
an event looks backdated, `canRefold` (`foldProjectionExecutor.ts:55-71`)
decides per delivery whether to do it, and 6 production folds opt out
individually — carrying roughly 150 lines of docblock arguing their own
accumulators commute
(`simulationRunState.foldProjection.ts:334-370`,
`experimentRunState.foldProjection.ts:108-139`,
`traceAnalytics.foldProjection.ts:1183-1205`,
`traceSummary.foldProjection.ts:460-487`,
`codingAgentSession.foldProjection.ts:219-232`,
`evaluationAnalytics.foldProjection.ts:458-465`). Most of those arguments are
unverified: the harness that would check them is opt-in, and its own header says
that "on most of the folds that set it the assertion has never been checked —
the same shape as the `simulationRunState` bug"
(`projections/orderInvariance.ts:7-12`). The default cost real availability: a
hot trace re-folded its entire history on every batch, pinning the checkpoint at
the aggregate's maximum event time so every later batch looked backdated too
(2026-07-09; `specs/event-sourcing/hot-trace-fold-amplification.feature`).

**Redelivery dedup is stored as a list.** Folds persist the ids of the events
already applied, per row: `AppliedEventIds Array(String)` on
`coding_agent_sessions`, `trace_analytics`, `evaluation_analytics` and
`experiment_runs` (migrations `00054`, `00056`, `00064`), 59 references across
21 files. Some aggregates carry more than 100,000 events. The list has also
become load-bearing in the read path — `length(AppliedEventIds) DESC` is a
tie-break inside a dedup `ORDER BY`
(`app-layer/coding-agent/repositories/coding-agent-session.clickhouse.repository.ts:458`),
where the same docblock notes it "saturates and discriminates weakly" (`:401`).

**A failed cache write leaves the stale entry in place.** `CachedFoldStore`
logs and continues (`projections/cachedFoldStore.ts:384-393`, behaviour at
`:432-437`), on the reasoning that "the durable write above already succeeded,
so the next read falls through to state that is genuinely there". That holds
only when the key was empty. When a prior write succeeded and this one failed,
the key still holds the *older* state, the next read serves it, and the fold
applies the next event on top of state it has already superseded.

## Decision

### 1. A pipeline is commands, events, projections, subscribers and process managers

A pipeline declares one name, one aggregate type and one event union. A command
carries `{ tenantId, aggregateId, type, data }` (`commands/command.ts:10-34`)
to a handler, and the handler's only output is events. Events are appended to
`event_log` by `EventSourcingService.storeEvents`
(`services/eventSourcingService.ts:286`), which is the sole writer, and only
then does the router fan out (`:331-353`). Fan-out failure never fails a
committed write.

Post-event work is exactly 2 things, and choosing between them is a durability
decision:

- **Event subscribers** — at-most-once, never replayed, and they receive no
  projection state (`subscribers/eventSubscriber.types.ts:5-9`). The routing
  path does not retry; nothing re-dispatches a subscriber's fan-out afterwards,
  so a lost job is lost permanently (`eventSubscriber.types.ts:16-24`). A
  subscriber may therefore only carry work whose loss is acceptable. Enqueue-time
  hooks on this seam must be total for the same reason.
- **Process managers** — durable, at-least-once, own their state, and drive
  external effects. One pure step,
  `evolve(previousState, input) -> { state, nextWakeAt, intents }`
  (`process-manager/processManager.types.ts:64-88`), identified by
  `(processName, projectId, processKey)`, with persistence, revision and
  idempotency behind a store port. An effect is an intent with a deterministic
  `messageKey`. Anything with a stake — money, an outbound message, a state
  transition a customer can see — is a process manager, not a subscriber.

A projection is a read model and nothing else. It emits no effects.

### 2. There are 2 kinds of projection, and the axis is where the accumulator lives

- **`map`** — no accumulator. Each event independently produces rows. Batching a
  map is an execution detail, not a semantic one: a batched map and an
  event-at-a-time map produce the same rows.
- **`fold`** — the accumulator lives in the row. Read prior state, apply, write
  back.

The datasource does not enter into it. A fold over Postgres is a fold; a map
into ClickHouse is a map. One registry, one executor and one replay path per
kind, and there is no third kind.

State belongs to whatever accumulates it, which is a projection or a process
manager. A pipeline may declare several, or none — so state is never a property
of the event vocabulary itself (ADR-105 §3).

`map` combined with a `merge` store is the only pairing that is not idempotent
under redelivery, because the engine adds rather than replaces. Such a
projection declares its idempotency story to mount; no other combination has to.

### 3. Nothing on the delivery path reads `event_log`

The line is precise, because the 2 operations look alike and cost differently:

- Reading your own last-committed projection row back is a **point read on the
  projection's own table**. It stays. It is how a cold cache recovers, and it is
  bounded by the aggregate's row, not its history.
- Replaying events out of `event_log` is **refolding**. It happens only in an
  explicit offline replay (ADR-101), which is the sole bulk reader of the log.

So `refoldOnStoreMiss`, `refoldsOnMiss`, `eventLoaderUpTo`, the streaming
refold, and both runtime assertions that make refusing a row survivable leave
the delivery path. A fold that needs continuity earns it by persisting enough
typed state to reconstruct its accumulator — a read-back row — which is a
requirement on the fold's state design, not a runtime option.

### 4. Ordering is best effort, so every fold must be order-invariant

Delivery order is not a contract. The queue scores a group's zset by the
projection's ordering key and pops the lowest, so events queued *together* are
applied in that order — but an event that arrives after a lower-scored sibling
has already been popped is applied late, and nothing rewinds. Order is a
convergence accelerator, not a guarantee.

It could not be a guarantee even if the queue were stricter. Telemetry and
scenario events are produced in a customer's process and cross a network before
we see them, so the stream is already unordered when it arrives. A strict order
imposed inside the pipeline would be a strong-looking promise over a shuffled
input.

So the requirement moves to the fold. Every field of a fold's state must be one
of 3 kinds, and a fold that cannot express its state this way is not admissible:

- **commutative and associative** — `sum`, `count`, `min`, `max`, set union.
  Order cannot matter, by algebra.
- **monotone by rank** — `status = max(current, incoming)` over a declared
  lattice, so `in_progress` can never lower `done`. A legal regression, such as
  a rerun or a cancellation after completion, is a new *generation*, not a
  downward step; without that the lattice forbids a transition the domain
  allows, which is how a cancelled run gets resurrected as a success.
- **last-write-wins by time** — ordered on `lastAcceptedAt`, tie-broken by
  event id.

Prefer rank over last-write-wins wherever the domain allows, because a lattice
needs no clock. Where last-write-wins is unavoidable, order it on
`lastAcceptedAt` — ADR-099's row-level role for "our boundary, on the latest
applied event" — never on `acceptedAt`, which is frozen for the row's life and
so cannot order anything, and never on `occurredAt`: `occurredAt` is stamped by
the customer's process, so a skewed clock can win permanently and freeze a
field forever. That hazard is worst exactly where ordering is least reliable —
scenario events, emitted furthest from us. A field whose write cadence needs
tracking independently of the row's latest-applied event carries its own
`asOf` column — a per-field stamp, distinct from the 4 row-level time roles
ADR-099 defines, of which `lastAcceptedAt` is one.

Order-invariance is enforced as a property test over each fold, not asserted in
a docblock. The existing harness already concedes the difference: "on most of
the folds that set it the assertion has never been checked"
(`projections/orderInvariance.ts:7-12`).

Ordering guards, backdated-event detection, monotonic clamps and refold-on-
out-of-order machinery written *inside* a fold are deleted. What replaces them
is not a weaker guarantee — it is a state model in which the guarantee is
unnecessary.

Read-layer dedup in ClickHouse is a different mechanism and stays: it resolves
which of several committed versions of a row a query should see, not which order
a fold applies events in (ADR-099).

### 5. Redelivery needs no guard, because a fold is a function of the set of its events

There is no sequence column on a projection row, no last-applied event id, and
no skip branch in the fold executor. A redelivered job is applied again, and
applying it again reaches the state it already had.

That is a requirement on the fold, not a hope about the queue. Decision 4 already
demands that state be a function of the *set* of events rather than of their
order; this decision says the same word literally. A set does not count
multiplicity, so every field must be idempotent as well as commutative:

| admissible field | why re-applying is a no-op |
| --- | --- |
| `max` / `min` | the second application compares equal |
| set union | the member is already present |
| monotone rank (with a generation where ranks tie) | the rank does not advance |
| last-write-wins carrying **its own** stamp | the stamp is unchanged, so the write does not win twice |
| first-write-frozen | already set |

`+=` is not on that list and is banned in fold state. A delta is an **item row**
keyed by its natural key — the `ReplacingMergeTree` collapses the redelivery to
one row — and the total is derived at read time over those rows (ADR-103). Most
pipelines already do this; the ones that did not were the entire reason a dedup
mechanism looked necessary.

**The property is checked, not asserted.** `checkOrderInvariance` sweeps every
permutation of the event set *and* the re-application of each event, and reports
`duplication` distinctly from `order` because the remedies differ: an ordering
failure wants a stamp or a rank, a duplication failure wants item rows. Every
fold calls it over a realistic event set in its own unit tests.

**The queue's per-group sequence stays where it is.** It is assigned in the same
atomic staging script that inserts the job, it is monotone per group, and it is
what a durable effect's `messageKey` and the dispatch-plane's observability are
built from. What it is not, any more, is a projection column: a guard on the row
would be a guard against a hazard the fold is required not to have, and carrying
it would have let a non-idempotent fold pass review.

Event-id comparison, where it is used, is bytewise
(`utils/compareOrdinal.ts:11-14`). Never `localeCompare`: ICU collation inverts
base62 KSUIDs at the `Z` → `a` step, so 2 workers would order the same pair
differently and neither would agree with ClickHouse's byte ordering of a
`String` column. The last applied event id survives only as a read-side
tie-break inside a dedup `ORDER BY`, where a total deterministic order is all
that is required.

The `AppliedEventIds` arrays are abolished.

### 6. A read has 3 outcomes, and undecodable is not genesis

1. **State found.** Which tier served it — cache or durable store — is invisible
   to the caller and visible in the logs and metrics.
2. **Genuinely absent.** No row for this aggregate. This is genesis: the fold
   starts from `init()`.
3. **Present but undecodable.** A row is there and this build cannot read it.
   This is a hard error. The job fails, retries on its budget, and surfaces to
   an operator.

The third outcome must never be collapsed into the second, and the failure it
prevents is the most dangerous single mistake available in this design:

1. **A deploy changes a fold's shape.** A new column, a renamed field, a
   tightened schema — anything the row's decoder now rejects.
2. **Every committed row for that fold fails to decode.** Not one aggregate:
   the whole population, simultaneously, on the first pod that rolls.
3. **Each is read as absent.** The fold takes outcome 2 and starts from
   `init()`.
4. **Each is overwritten with a fresh accumulator**, stamped at the *current*
   version — which the decoder that just rejected the old row accepts happily
   from then on.

The corruption launders itself. The row now reads clean, the metrics are quiet,
and the original state is gone. There is no signal afterwards distinguishing "a
counter that legitimately restarted" from "a counter whose history was
silently discarded", because the only evidence was the row that got
overwritten. Failing the delivery is loud, recoverable and bounded to the
aggregates actually affected; treating it as genesis is silent, permanent and
population-wide.

A store that can refuse a row it found must be able to say *why* it returned
nothing. `absent` and `undecodable` are distinct answers, and a store that
cannot tell them apart reports `absent` only when it genuinely cannot find a
row at all.

### 7. Durable store first, cache second, and a failed cache write deletes the key

The order is fixed: commit to the durable store, then write the cache. A
fire-and-forget durable write would break the ordering outright, which is why
ADR-104 prohibits it.

**A cache write that fails deletes the key.** It does not log and leave what is
there. A stale entry is worse than no entry, and by exactly the amount that
matters: the next read serves superseded state, the fold applies the next event
to it, and commits a *newer version of wrong state*. The delete is best-effort
in the same sense the write was — if it also fails, the entry's TTL bounds the
damage — but leaving a known-stale entry deliberately is not an option.

**A cache that is unreachable fails open to the durable store.** An unreadable
or absent cache entry is a miss, not an error: the state is still in the durable
store, and the read falls through
(`projections/cachedFoldStore.ts:281-296`, `:309-320`). The cache is a latency
tier. Losing it costs latency and costs the read-your-writes window; it does not
cost correctness.

### 8. An event may carry a durable reference, and its lifetime is not the job's

An event may hold a durable *reference* to a payload stored elsewhere instead of
the payload inline. This is not the same thing as the dispatch plane's transient
job-payload spool (ADR-100), and conflating the 2 lifetimes loses data:

- A **job blob** is reclaimable once the job completes. Reclamation is exactly
  what the spool is for — leases refuse a delete while a job still holds one
  (`queues/groupQueue/blobDeleteLua.ts:38-41`) and expiry lazily reclaims the
  rest.
- A **blob referenced from an event** is meant to outlive the event's
  retention — the event is the durable record, and a reference whose target
  has been reclaimed is a record that no longer says anything. The one adopter
  that offloads to a durable blob does not yet meet this; see the retention
  gap below.

Cross-pipeline commands on high-volume streams carry references, not bodies. The
live shape is the coding-agent span bridge: a total field-pick at the fan-out
seam swaps the staged payload for a small reference that mirrors the source
event's scheduling identity, and the handler resolves it against the span store
(`pipelines/coding-agent-processing/subscribers/codingAgentSpanFactsDispatch.subscriber.ts:73-78`,
resolution at `:101-116`). A reference the seam cannot build stages the whole
event, so the handler understands both shapes.

**The other live shape bounds a payload that is itself the point, not a
routing convenience.** An evaluator `inputs` value — the conversation, RAG
chunks, tool outputs a run was scored against — reaches GB scale for some
tenants, and lands verbatim in both `event_log.EventPayload` and the
evaluation fold row. Above the inline threshold, **`EVAL_INPUTS_INLINE_MAX_BYTES`
(1 MiB)**, the serialized inputs move to the content-addressed stored-objects
service and both places carry a bounded marker instead — a valid JSON object,
so every existing `JSON.stringify`/`JSON.parse` seam over the field keeps
working, holding the object id, a 16 KiB preview and a `truncatedPreview` flag.
The marker is resolved back to the full inputs only at API read boundaries
(`EvaluationService.getEvaluationInputs`), never inside a fold — resolving it
there would re-inline the fat payload on the next re-fold and defeat the bound
this decision exists to enforce.

**The retention gap.** `stored_objects` has no TTL — its migration defines
none, and the no-retention invariant is pinned by a test — so the reference
above does not, in practice, merely outlive the event's retention: it outlives
the row and the event both, by an unbounded margin, persisting until the
project itself is deleted (the stored-objects project-delete cascade is what
eventually removes it). A reference is supposed to outlive the record that
points to it, not outlive it indefinitely for an unrelated reason. This is
accepted for now, not resolved: the fix is a retention-aware sweep that deletes
an offloaded object once the row that referenced it has aged out of its own
retention, and no such sweep exists yet.

### 9. Crossing pipelines needs a command bridge exactly when the aggregate key changes

- **Keys differ → a command bridge is required.** The bridge *is* the re-key,
  and the re-key is what restores FIFO per the target's aggregate. Without it
  the target's events arrive grouped by the source's key, and the target's folds
  lose the per-aggregate lane that decision 4 relies on for convergence.
- **Keys match → subscribe to the source's events directly.** A bridge there
  buys a schema boundary and nothing else, and should be justified as a schema
  boundary if it is wanted.

The live example is the coding-agent session. Its aggregate is
`coding_agent_session`
(`pipelines/coding-agent-processing/pipeline.ts:63`), fed by 3 contribution
commands (`:96-98`) dispatched from subscribers mounted on 3 source pipelines
whose aggregates are `trace`, `log` and `metric`
(`pipelines/trace-processing/pipeline.ts:181`+`:247`,
`log-processing/pipeline.ts:29`+`:41`,
`metric-processing/pipeline.ts:39`+`:65`). 3 different keys, 3 bridges, and
one ordered lane per session on the far side.

## Rationale / Trade-offs

**Why is the accumulator the axis, and not the datasource?** Because the
datasource changes what a write costs and the accumulator changes what a write
*means*. A projection with an accumulator has a read-modify-write cycle, so it
needs an ordered lane, a delivery mark and a defined answer for a missing row.
A projection without one needs none of those: its rows are a pure function of
the event, so 2 deliveries of the same event produce the same rows and batching
is free. Splitting on Postgres-versus-ClickHouse instead put a Postgres fold in
its own kind while leaving it the same 3 problems, which is how 6 mounts ended
up with a hand-rolled subset of the fold contract and a separate replay path to
match.

**Why is `map` + `merge` the only combination needing an idempotency story?**
Because it is the only one where the storage engine's resolution of 2 rows
sharing a key is *addition*. `append` keeps both, which is what a map wants;
`replace` takes the newest, which makes a redelivery a no-op. A merge engine
adds, so a redelivered event increments a total that was already correct — and a
map has no accumulator in the row to hold a delivery mark against. The
idempotency has to come from somewhere else (a deterministic key the engine
collapses on, or a downstream dedup), and the projection says where at mount
time rather than discovering it in a drifted counter.

**Why delete the out-of-order refold rather than bound its cost?** Because
replaying history cannot repair a disorder that originated outside the system.
The producer stamped the event; by the time we see it the ordering is already
lost, so re-deriving from `event_log` yields the same state the fold would have
reached anyway, at the cost of a full history scan. Bounding the replay leaves
the apparatus in place, still requiring each fold to prove its accumulators
commute in order to opt out — proofs that are unverified on most adopters.
Requiring order-invariance instead makes the same proof mandatory and checkable,
and then nothing needs repairing. The replay also raised the checkpoint to the
aggregate's maximum event time, so one backdated event made every later batch
look backdated too, which is where the quadratic behaviour came from rather than
from any single replay's size.

**Why no dedup mechanism at all, rather than a good one?** Every candidate makes
correctness depend on machinery outside the fold. A bounded ring of recent event
ids has a window, so a redelivery older than the ring is double-applied and
nothing detects it, and the window then has to be tuned against the queue's
retry ladder. An event-time watermark cannot tell a late arrival from a
redelivery — decision 4 makes late arrival normal, so the watermark would
silently discard genuinely new events, most often on the aggregates with the
most producers racing for them. A per-row delivery sequence has neither flaw,
but it buys idempotence for a fold that has not earned it: with the guard in
place a `+=` field passes review, and the guard is the only thing standing
between it and a double count on the first retry. Removing the guard makes the
requirement structural, and `checkOrderInvariance`'s duplication sweep makes it
checkable.

**Why does an undecodable row throw rather than skip the event?** Skipping is
also wrong, but it is wrong recoverably: the aggregate falls behind and the
metric that says so keeps rising. Folding onto `init()` destroys the evidence
that anything happened, and does it to every aggregate the fold owns on the
first pod of the deploy. Throwing puts the job on a retry budget, keeps the
committed row intact, and makes a shape change that the decoder cannot handle a
deploy failure rather than a data-loss event.

**Why must a subscriber's work be losable?** Because the fan-out seam runs
behind an already-committed write and cannot fail it. Retrying the fan-out would
mean holding the write open on a second system's availability; failing the
write would mean the log rejects events because a read model's queue is
unhealthy. Neither is acceptable, so the seam reports and continues — which
makes at-most-once the honest contract, and makes process managers the only
place a stake-bearing effect can live.

## Consequences

- **3 mount points collapse to 2.** One registry, one executor and one replay
  path per kind. 6 mounts move from a bespoke contract onto the fold contract
  with a `replace` store, and gain the read-outcome and delivery-mark rules
  they never had.
- **The delivery path's worst case becomes bounded.** With no refold, a fold's
  per-delivery work is one point read, one apply and one write, regardless of
  how many events the aggregate has accumulated. The unbounded cold-partition
  scan that the delivery path could reach is gone.
- **Continuity becomes a design constraint on fold state, not a runtime
  option.** A fold whose row cannot reconstruct its own accumulator no longer
  has a fallback — it has a bug that surfaces at design time. This is stricter
  than what exists now, and deliberately so, but it does mean a fold whose
  persistable-signal predicate can decline to write a row must either persist
  something or accept restarting from genesis; that decision now has to be made
  explicitly per fold rather than absorbed by a refold nobody costed.
- **Roughly 150 lines of per-fold commutativity argument are deleted**, along
  with the opt-in harness and shrink-only ratchet built to check claims the
  design no longer asks folds to make.
- **A previously silent corruption becomes a loud failure.** Reading a row as
  absent when it was found and refused could overwrite an entire fold's
  population with fresh accumulators, undetectably. It now fails the delivery.
  The cost is that a genuine schema mistake takes a fold's queue down instead of
  quietly resetting it — which is the correct trade, and it is the reason the
  `absent`/`undecodable` distinction is part of the store contract rather than
  an optional refinement.
- **A stale cache entry stops being a documented non-issue.** The current write
  path's reasoning is sound only for an empty key, and on a non-empty one it
  serves superseded state into the next fold step. Deleting on failure converts
  that into a cache miss.
- **4 ClickHouse tables shed an `Array(String)` column**, and one dedup
  `ORDER BY` sheds a tie-break key that its own docblock describes as weakly
  discriminating. No table gains a replacement column: decision 5 removes the
  dedup requirement rather than relocating it.
- **Cross-pipeline wiring gains a rule with a test attached to it.** "Bridge
  when the key changes" is checkable from a pipeline definition; the previous
  answer was per-case judgement, which is how a bridge becomes either a missing
  re-key or ceremony around a direct subscription.

## Migration order

The rules land in this order, because 2 of them cannot be enforced yet: one
while data written under the old shape is still readable, the other while an
adopter still depends on the mechanism being removed for continuity.

1. **The taxonomy.** `withProjection` is removed and its 6 mounts become folds
   with `replace` stores. No data changes.
2. **Ordering.** `refoldOnOutOfOrder`, `canRefold` and the per-fold opt-outs are
   deleted. The licence for this is decision 4's order-invariance requirement,
   not FIFO — GroupQueue's per-group ordering is best effort, never a
   guarantee, so it cannot be the reason a guard is safe to remove.
3. **The read-outcome rule.** Decision 6's `absent`/`undecodable` distinction —
   an undecodable row is a hard error that fails the job, never treated as
   genesis — takes effect immediately, for every fold. It does not wait on
   step 7 below: the refold was never what made a refusal survivable, and
   nothing in this design reinstates it as one.
4. **Continuity redesign.** Each fold that currently depends on
   `refoldOnStoreMiss` for continuity — the Context names this class
   (`traceSummary.foldProjection.ts:482-487`) — is redesigned to persist enough
   typed state in its own row to reconstruct its accumulator from a plain
   read-back, per decision 3. This is a per-adopter code change with its own
   review and rollout, not a wait for data to age.
5. **Every remaining `+=` field becomes item rows.** A fold that still
   accumulates a delta in its own state is converted to item rows keyed by their
   natural key with the total derived at read (ADR-103), and the conversion is
   proved by `checkOrderInvariance` reporting no `duplication` counterexample.
   This is the whole of decision 5's migration: there is nothing to add to a
   row, only something to stop keeping in one.
6. **The applied-id lists** are dropped once the one read that still depends on
   them — the dedup `ORDER BY` tie-break at
   `coding-agent-session.clickhouse.repository.ts:458` — is moved onto the
   table's own version column, and retention has aged out every row whose only
   dedup evidence is the array.
7. **The refold path is removed** once every adopter identified in step 4 has
   shipped its redesign. `refoldOnStoreMiss`, `refoldsOnMiss`, `eventLoaderUpTo`
   and the streaming refold are deleted, and both runtime assertions that made
   refusing a row survivable go with them. The delivery path's behaviour on an
   undecodable row does not change when this step lands — it was already a
   hard error since step 3.

Steps 6 and 7 are the 2 carried items in the status line — one behind data
ageing, one behind per-adopter redesign.

## What does not move

- **ClickHouse read-layer dedup.** Choosing among committed versions of a row at
  query time is not ordering the fold; it is ADR-099's concern and it stays.
- **Reading your own last-committed row back.** It is a point read, it is how a
  cold cache recovers, and decision 3 keeps it explicitly.
- **The cache read path's fail-open behaviour.** An unreachable or unreadable
  cache is a miss, and falling through to the durable store is already correct
  (`projections/cachedFoldStore.ts:281-296`).
- **`event_log` as the source of truth.** Every decision here is about who may
  read it and when, never about whether it is authoritative.

## References

- `langwatch/src/server/event-sourcing/pipeline/staticBuilder.ts:104-252` — the
  3 registries and 3 mount points.
- `langwatch/src/server/event-sourcing/projections/stateProjection.types.ts:27-51`
  — the third kind's store, and its own admission that it is a fold.
- `langwatch/src/server/event-sourcing/projections/stateProjectionExecutor.ts:5-65`
  — the delivery-mark cursor, already correct in one lane.
- `langwatch/src/server/event-sourcing/projections/foldProjection.types.ts:140-230`
  — `eventOrdering`, `readWindow`, `refoldOnStoreMiss`, `refoldOnOutOfOrder`.
- `langwatch/src/server/event-sourcing/projections/foldProjection.types.ts:262-327`
  — `refoldsOnMiss` and the `absent`/`undecodable` contract.
- `langwatch/src/server/event-sourcing/projections/foldProjectionExecutor.ts:55-71`,
  `:115-133`, `:200-221`, `:679-717` — refold branches, the windowed recovery
  read, and both undecodable assertions.
- `langwatch/src/server/event-sourcing/projections/cachedFoldStore.ts:281-320`,
  `:384-437` — read fail-open, and the write-failure behaviour decision 7
  replaces.
- `langwatch/src/server/event-sourcing/projections/orderInvariance.ts:1-21` —
  order-insensitivity as an unchecked claim.
- `langwatch/src/server/event-sourcing/queues/groupQueue/groupQueue.ts:245-252`
  and `services/queues/queueManager.ts:142-158`, `:428-441` — per-group FIFO and
  the fold group key.
- `langwatch/src/server/event-sourcing/subscribers/eventSubscriber.types.ts:5-24`
  — at-most-once, and why the seam cannot retry.
- `langwatch/src/server/event-sourcing/process-manager/processManager.types.ts:12-88`
  — the durable process contract.
- `langwatch/src/server/event-sourcing/utils/compareOrdinal.ts:1-14` — bytewise
  event-id comparison.
- `langwatch/src/server/clickhouse/migrations/00054`, `00056`, `00064` — the
  `AppliedEventIds` columns decision 5 abolishes.
- `specs/event-sourcing/fold-projection.feature`,
  `map-projection.feature`, `post-event-work.feature`,
  `pipeline-model.feature`, `hot-trace-fold-amplification.feature`.
- `langwatch/src/server/app-layer/evaluations/evaluation-inputs-offload.ts`,
  `evaluation-column-caps.ts` — decision 8's durable-reference worked example
  and its unconditional row-cap backstop.
- `langwatch/src/server/stored-objects/` — the content-addressed store decision
  8's offload reuses, including the no-TTL invariant test the retention gap
  refers to.
- `specs/evaluations/evaluation-payload-offload.feature`.
