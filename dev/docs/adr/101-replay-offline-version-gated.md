# ADR-101: Replay is offline, version-gated, and the only bulk reader of `event_log`

**Date:** 2026-07-29

**Status:** Superseded by [ADR-108](./108-the-dispatch-plane.md) (2026-07-30). Previously: Accepted — the boundary is in force as a rule; the one crossing named
in Context is still in the code and is deleted by the migration this ADR arms.

**Builds on:** ADR-098 (the third read outcome — present but undecodable —
which this gate turns from a dead end into an operator action).

**Related:** ADR-099 (the fold store and codec that stamp the rows a replay
rebuilds), ADR-100 (the group-key descriptor replay must render to pause and
drain the right lanes).

## Context

The delivery path reads `event_log`. A fold whose store reports a miss rebuilds
that aggregate's state from history inline, on the job:
`foldProjectionExecutor.ts:354` on the single-event path and
`foldProjectionExecutor.ts:520` on the batched one, both entering
`refoldUpToDelivered` (`foldProjectionExecutor.ts:729`), which pages the
aggregate's whole history out of the event log before applying the delivered
event. It is armed per store (`foldProjectionExecutor.ts:646`).

That is one edit away from being the steady state rather than the exception, and
the difference is invisible from outside the process: a transitional rebuild and
a regression to walking the log on every cache miss emit the same counter, which
is why the counter carries an outcome label at all (`metrics.ts:506`). The
regression has a cost of record — the 2026-07-23 `TOO_MANY_PARTS` outage, named
at `metrics.ts:511`.

A second defect, smaller and sharper. The replay cutoff is a position in
`(EventTimestamp, EventId)`: the marker is written as `{timestamp}:{eventId}`
and compared against `event.createdAt` (`replayMarkerCheck.ts:95`,
`replayConstants.ts:50`), and the bulk load orders by the same pair
(`replayEventLoader.ts:521`) — legitimate, because replay is reading the event
log in log order and the cutoff is only where that reading stops. What is not
legitimate is deciding redelivery the same way. The live checker's skip
decision presently keys off `(occurredAt, eventId)`, a column the loader
resolves separately from the cutoff's timestamp and falls back to only when it
is absent (`replayEventLoader.ts:61`, `:75`), so today the two event-time marks
can even disagree with each other at the edge. Aligning the columns would not
fix the underlying defect: an event-time mark cannot tell a retried job from a
genuinely late-arriving one, and decision 7 replaces it with delivery identity
— a monotonic per-group sequence assigned at staging — rather than a
better-aligned watermark.

## Decision

### 1. Replay exists for two reasons, and neither is delivery

Migrating a projection to a new version, and disaster recovery. Nothing else
starts one.

There is one entry point: the operator mutation `startReplay`
(`api/routers/ops.ts:446`), gated by `opsManagePermission`
(`api/routers/ops.ts:48`), which resolves the runtime through
`createReplayRuntime` (`replayPreset.ts:56`) and holds a run lock
(`ops/replay.service.ts:59`).

Reachability is checked, not assumed. Outside the directory and its tests,
`event-sourcing/replay/` has three importers: `ops/replay.service.ts` for the
runtime and its types, `projections/replayMarkerCheck.ts` for `replayConstants`
alone — the live side of the protocol in decision 7 — and two callers of
`pMapLimited`, a generic concurrency helper that happens to sit in the folder
and touches no replay machinery. No worker, queue handler, projection or
pipeline reaches an accumulator or a replay path.

### 2. Replay is the sole bulk reader of `event_log`

Every multi-aggregate `SELECT` over the event log lives in one module,
`replayEventLoader.ts` — discovery (`:117`), counting (`:154`), occurred-at
bounds (`:269`), cutoff resolution (`:320`) and the two loaders (`:431`,
`:498`). Nothing else may issue one.

A point read of one row by `EventId` is not a bulk read and is not covered:
resolving a durable payload reference reads exactly the row the reference names
(`blob-store.service.ts:196`), which is a primary-key lookup on a read query,
not a scan on a write path. Widening the rule to "no reads at all" would
prohibit durable reference events, which ADR-098 requires; narrowing it to "no
full scans" would readmit the per-aggregate history walk, which is the thing
that broke. The line is drawn at cardinality, not at intent.

### 3. Replay runs no subscribers and re-dispatches no outbox

Post-event work is an effect of an event being observed for the first time, not
of the event existing. Replay re-derives derived state; it does not re-enact
history.

The property is structural rather than conventional. Each accumulator applies
the projection's pure function and writes through the store —
`replayExecutor.ts:105`, then `:153` for a fold and `:281` for a map — and never
constructs the router, which is the only thing that dispatches to event
subscribers. Subscribers and process managers are unreachable from replay by
construction, and the argument is already written down at the one place that
depends on it (`groupQueue.ts:1846`).

What re-running them would do is not hypothetical: automation alerting and usage
reporting are subscribers on the same pipeline (`groupQueue.ts:1853`), so a
replay that dispatched would re-fire alerts, re-charge budgets and re-emit audit
records for every event it read. Adding an idempotency key per subscriber would
make some of that survivable and none of it correct — a webhook that fires twice
under the same key still fired twice.

### 4. A row below the decoder's floor is refused, never decoded

A fold's codec declares every shape it has written, oldest first, and each row
carries the stamp of the shape that wrote it (`foldStore/foldCodec.ts:65`,
`:20`). `readBackSince` names the oldest shape this build's decoder can read
(`:72`). The gate is one comparison: where the row sits on the ladder against
where the decoder starts (`:201`).

A row that resolves to no generation — an unrecognised stamp, a withdrawn shape,
or a stamp whose evidence the row does not carry (`:181`) — is reported as found
and refused, distinct from absent (`defineFoldStore.ts:252`). ADR-098 makes that
third outcome a hard error; this ADR is what makes the error actionable, because
the operator's response is named: replay the affected aggregates at the new
version. With the delivery-path refold gone, the guard that refuses to fold onto
`init()` after a refusal becomes unconditional (`foldProjectionExecutor.ts:679`)
— which is the decision, not a regression. Teaching the decoder to tolerate old
rows instead would put the gate in two places that can disagree, which is why
`decode` is required to be total and forbidden to gate (`foldCodec.ts:88`).

### 5. Declaring a new shape and refusing the old one are two deploys

A version bump rolls forward in a fixed order, and the order is what stops two
builds disagreeing about which shape is current:

1. **Append a generation.** The stamp every new row carries is always the newest
   generation's (`foldCodec.ts:196`), so only one shape is ever written and
   "which shape is current" has no second answer. `readBackSince` stays where it
   is, so the old and new builds both still read old rows.
2. **Deploy.** New rows carry the new stamp; old rows remain readable, so no
   aggregate is refused and no lane stalls.
3. **Replay.** Rows below the new shape are rebuilt and re-stamped.
4. **Raise `readBackSince`** in a second change — the only thing that arms
   refusal of whatever is left.

Raising `readBackSince` in step 1 collapses the ratchet into an outage: every
aggregate whose row predates the deploy is refused on its next event, and the
rebuild that makes refusal safe has not run yet.

The generation list is append-only, and the newest generation may not be
withdrawn — a fold that writes a shape it refuses to read commits rows nothing
can ever read back, so withdrawing the current shape means declaring the next
one (`foldCodec.ts:162`). The fold cache is keyed by the written stamp
(`defineFoldStore.ts:193`), so a shape change misses rather than serving old
state past the gate.

### 6. What a decoder reads back is ratcheted

The ladder cannot catch the discipline failure on its own: a decoder edited to
read one more persisted detail, with no new shape declared, passes every test —
every row a test writes is written by the same build — and in production decodes
one detail short, silently, under a stamp saying it is fine.

So the fingerprint of what a decoder reads back is checked in and asserted
(`generationRatchet.ts:43`, hashing the declared `reads` list at
`foldCodec.ts:210`). Changing what a fold reads back without growing its
generation count fails the build. The guard is one-directional on purpose:
declaring a shape without changing `reads` is ordinary, because a shape can
change for reasons a column list does not capture. What is refused is the
reverse — the reads moving underneath a stamp that stayed still.

### 7. The pause is per batch, and the cutoff is what makes it safe

Each batch of aggregates runs seven phases (`replay/types.ts:66`), in order:
mark pending (`replayFoldPath.ts:326`), pause the lane (`:331`), drain in-flight
jobs (`:336`), resolve the cutoff within occurred-at bounds so the log's
partitions prune (`:355`), write the cutoff markers (`:390`), stream events
through the accumulator (`:392`), flush (`:447`), then mark complete and unpause
(`:462`, `:463`).

While a batch is marked, the live checker resolves every event for those
aggregates into one of three answers (`replayMarkerCheck.ts:86`): `pending` or
past the cutoff defers, at or before the cutoff skips because replay is
rebuilding it, and neither marker present processes normally (`:116`). Deferral
is a recoverable error, so the queue re-stages with backoff
(`replayMarkerCheck.ts:14`) — that is what lets a batch pause without dropping
anything.

Completion replaces the active marker with a short-TTL terminal one rather than
deleting it (`replayMarkers.ts:131`, `replayConstants.ts:34`). A job staged but
never active during the pause is not drained, so it runs after unpause; without
the preserved boundary it would re-apply events replay just rebuilt. Markers
carry a 7-day safety TTL so an abandoned replay cannot block a lane for ever
(`replayConstants.ts:9`).

What makes this safe is delivery identity, not a shared time order. Each job
staged into a fold's lane carries a monotonic per-group sequence number
assigned at staging — a precondition this ADR takes as given, not yet built in
GroupQueue — and the row records the last sequence it applied. A job staged
before the pause but not yet active when it lifts carries a sequence the row
has already advanced past, so it is skipped as already folded by replay; a
timestamp comparison cannot make that call, because it cannot tell a job
replay has already covered apart from a legitimate late arrival. The cutoff
itself keeps `(occurredAt, eventId)` ordering, compared bytewise on the id
(`replayConstants.ts:58` — plain string comparison, never `localeCompare`),
because bounding the bulk load so the log's partitions prune is the only thing
the cutoff does.

### 8. Replay renders group keys through the descriptor, never by hand

Replay must pause and drain the exact lanes the dispatch plane feeds, so it
renders keys through ADR-100's single rendering function rather than
reconstructing them. A hand-built id (`replayDrain.ts:26`, against a hard-coded
queue prefix at `:9`) drains whatever it happens to spell; when the descriptor's
rendering changes — an escape rule, a cluster hash-tag position — it drains
nothing and reports success.

Two lane shapes need two drains, and the descriptor tells them apart. A fold
lane is scoped per aggregate, so its key is reconstructible exactly from the
discovered aggregates and drained by direct read. A map lane may be scoped to a
declared partition whose parts are not derivable from an aggregate id, so it is
drained by scanning the descriptor's own prefix (`replayDrain.ts:36`). Both
prefixes come from the same function.

## What does not move

- **Reading a projection's own last-committed row back is not refolding.** It is
  how a cold cache recovers, it reads the projection's table and not the event
  log, and ADR-099 owns it.
- **ClickHouse read-layer dedup** is a property of a table's merge strategy, not
  an ordering guard, and is unaffected.
- **Point reads of `event_log` by `EventId`** for durable payload references stay
  on the read path.
- **The post-replay `OPTIMIZE TABLE` hint** stays best-effort and non-fatal
  (`replayService.ts:170`): it makes a replacing table dedup sooner, and a
  failure only means the merge happens later.

## Rationale / Trade-offs

**Why bar replay from the delivery path rather than bounding it?** Because every
bound is a number someone can raise, and the failure mode is not slowness. An
inline rebuild turns one event into a full history scan under whatever load
produced the miss, so the cost scales with the incident rather than with
traffic — a cold cache after a deploy makes every aggregate pay it at once. The
store read-back exists precisely so the delivery path never needs the log, and
leaving one path that does makes the guarantee unverifiable by inspection.

**Why does replay get its own ADR rather than a section in ADR-098?** So that
"the delivery path never reads `event_log`" has somewhere to be absolute. Stated
beside fold semantics it reads as a preference; stated as the scope boundary of a
separate mechanism, code that violates it is in the wrong file.

**Why a two-deploy version bump rather than one?** The two halves have opposite
failure modes. Writing a new shape is safe alone — old rows stay readable.
Refusing an old shape is safe only after the rebuild. Shipping them together
makes correctness depend on a replay finishing before the next event arrives,
which is not something a deploy can guarantee.

**Why is the ratchet a checked-in fingerprint rather than a type?** The change it
catches is behavioural, not structural: the same row type, decoded to read one
more of its fields. No type says "this decoder used to read 4 columns and now
reads 5". A hash of the declared list does, and it fails the build in the commit
that changed it.

**Why per-batch pause rather than pausing the projection for the run?** A
full-tenant replay runs for hours, and a lane paused for hours is an outage with
a nicer name. Per batch, a lane stops for as long as one batch of aggregates
takes and events for every other aggregate keep flowing. The cost is the marker
machinery in decision 7 — the pause is cheap because the cutoff is what actually
holds the line.

## Consequences

- The delivery path has no path to `event_log`. A projection's per-item cost is
  bounded by its own table plus its cache, and the class of incident where a
  cache miss becomes a history scan is closed by construction rather than by a
  counter someone has to watch.
- A fold's undecodable read is a hard error with a named remedy. It was
  previously survivable by an inline rebuild, which is what made shipping a
  decoder change without a generation feel free.
- Migrating a projection version takes 2 deploys and an operator-run replay where
  it took 1 deploy. That is worse for whoever ships the change, and it is the
  trade: the 1-deploy version silently reset aggregates to a fresh accumulator
  whenever a shape moved.
- Every new fold store must declare its `reads` list and appear in the checked-in
  generation record, or the build fails. A fold cannot be added quietly.
- The per-row skip decision moves off a shared time order entirely. Today the
  cutoff is written and compared in `(EventTimestamp, EventId)` while the
  per-row mark is `(occurredAt, eventId)`; where those columns differ, an event
  at the boundary can be both skipped by the live checker and missed by the
  rebuild. Delivery identity replaces the per-row mark, so that disagreement
  cannot recur; the cutoff keeps `(occurredAt, eventId)` ordering, because
  bounding the bulk load is all it is for. Delivery identity is a precondition
  this ADR takes as given, not yet built in GroupQueue — landing it is part of
  adopting this ADR, not a follow-up.
- Draining depends on ADR-100's rendering function being the only speller of
  group keys. A second speller inside replay fails silently: it drains no lanes,
  reports having drained them, and the rebuild then races live writes for the
  same rows.
- `specs/event-sourcing/projection-replay.feature` pins the operator contract in
  9 scenarios — cutoff skip, past-cutoff deferral, resumption skipping completed
  aggregates, fold and map replayed together, per-batch pause, a batch failure
  resuming live processing, and bulk writes — of which 8 carry binding tags and 1
  is `@unimplemented`. It does not pin the version gate, the two-deploy roll
  forward, or the absence of subscriber dispatch; those need scenarios before the
  code moves.

## References

- `langwatch/src/server/event-sourcing/replay/` — `replayService.ts`,
  `replayFoldPath.ts`, `replayMapPath.ts`, `replayOptimizedPath.ts`,
  `replayEventLoader.ts`, `replayDrain.ts`, `replayMarkers.ts`,
  `replayConstants.ts`, `replayDiscovery.ts`, `replayPreset.ts`, `types.ts`
- `langwatch/src/server/event-sourcing/replay/replayExecutor.ts` — the
  accumulators, and the structural absence of a router
- `langwatch/src/server/event-sourcing/projections/replayMarkerCheck.ts` — the
  live-side three-way decision
- `langwatch/src/server/event-sourcing/projections/foldStore/foldCodec.ts`,
  `generationRatchet.ts`, `defineFoldStore.ts` — the gate and the ratchet
- `langwatch/src/server/event-sourcing/projections/foldProjectionExecutor.ts` —
  the delivery-path refold this ADR deletes
- `langwatch/src/server/api/routers/ops.ts`,
  `langwatch/src/server/app-layer/ops/replay.service.ts` — the operator entry
  point and the run lock
- `specs/event-sourcing/projection-replay.feature`
- ADR-098 (event-sourcing core), ADR-099 (projection storage), ADR-100 (dispatch
  plane)
