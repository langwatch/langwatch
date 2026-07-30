# ADR-107: A pipeline is one declaration, and the engine reads every part of it

**Date:** 2026-07-30

**Status:** Accepted — supersedes ADR-098, ADR-105 and ADR-106, which are the
same subject split three ways.

**Supersedes:** ADR-098 (the core taxonomy), ADR-105 (the declaration shape),
ADR-106 (the mount checker).

**Related:** ADR-108 (the dispatch plane that delivers everything declared
here), ADR-109 (the stores a member mounts onto), ADR-110 (where this lives as
a package), ADR-103 (runs — the worked example of a fold retired into a query,
unchanged by this).

## Context

Three ADRs described what a pipeline is. ADR-098 owned the taxonomy, ADR-105
owned the declaration syntax, ADR-106 owned which combinations were legal. Each
was internally sound. The defect was the seam between them, and it is worth
stating precisely because it is the whole argument for one document.

`.id()` is declared per event and, by ADR-105 decision 4, is two things at
once: the lane a fold is serialised on, and the row key it reads back. ADR-106
decision 3 then reasoned about what `.build()` can and cannot decide, and
concluded a fold's scope is "a structural fact rather than an assumption"
because `.withFold` exists only after `.id()`.

Neither document asked whether the builder actually *used* the map. It did not.
`state.id` was written and never read except for an `undefined` guard;
`assemble()` returned no `id` field and `BuiltPipeline` declared none. All nine
declared id maps were dead code, and the fold key came from whatever the caller
put in `delivery.key`. So the lane and the row key were re-derived by hand —
roughly twenty `*GroupKey` helpers across nine `index.ts` files, none of them
reachable from the declaration they duplicated.

That is exactly the defect ADR-105's own Context named as motivating: "one
session id was derived in three different places and split a customer's session
across two aggregates." The declaration was supposed to remove two of the three
sites. Instead it added a third, and no document owned the question that would
have caught it, because the question fell between them.

A second instance of the same shape: ADR-106 decision 2's table refuses `map` +
`replace`, while the checker's own enumeration of legal shapes listed twelve
`map` + `replace` combinations as legal. Two artefacts, one rule, opposite
answers, and nothing comparing them.

The merge is therefore not tidying. Splitting one subject across three
documents produced two contradictions between them and zero inside any of them.

## Decision

### 1. A pipeline is one chain, and it is the whole topology

```ts
export function createTracePipeline(deps: TraceDeps) {
  return definePipeline("trace")
    .prefix("lw.obs")
    .events(traceEvents)
    .id({
      spanReceived:   (data) => data.traceId,
      topicAssigned:  (data) => data.traceId,
      originResolved: (data) => data.traceId,
    })
    .withCommand("recordSpan", { input: rawSpanSchema, handle: recordSpan(deps) })
    .withFold("traceSummary", {
      state: traceSummaryStateSchema,
      pin: TRACE_SUMMARY_STATE_VERSION,
      init: initTraceSummary,
      on: { spanReceived: applySpanReceived, topicAssigned: applyTopicAssigned },
      store: clickhouseReplacing({ client: deps.client, table: traceSummaryTable }),
    })
    .withMap("spanStorage", {
      scope: perEvent(),
      on: { spanReceived: toSpanRow },
      store: clickhouseAppend({ client: deps.client, table: storedSpansTable }),
    })
    .build(ports);
}
```

Everything the pipeline is, is in that file: its vocabulary, its identity, its
members, the infrastructure each member writes to, and — new here — the scope
each non-fold member is dispatched on. Nothing about it is stated anywhere else,
and nothing outside it derives a lane, a row key, a type string or a version.

### 2. Five members, one mount shape

| member | accumulates | writes to | scope |
| --- | --- | --- | --- |
| `.withCommand` | nothing | the event log, via the events it returns | `aggregate`, always |
| `.withFold` | state, read back before each apply | a `replace` store | `aggregate`, always |
| `.withMap` | nothing | an `append` or `merge` store | declared |
| `.withProcessManager` | state, and a wake deadline | a `replace` store and the outbox | `aggregate`, always |
| `.withSubscriber` | nothing | whatever it calls | declared |

Every member mounts as `.withX(name, record)`. The name is the member's identity
in metrics, logs, stored rows and lane names. The record is a plain object
literal typed against `.events()` — a command is always `input` then `handle`,
and nothing inside a mount is gated on anything else inside it, so a mount is a
record rather than a chain.

The outer chain earns currying because each step's type depends on the one
before: `.events()` fixes the vocabulary every handler below it is typed
against, and `.id()` decides whether `.withFold` and `.withProcessManager` exist
at all.

### 3. An event is its payload schema, and nothing else

```ts
export const traceEvents = {
  spanReceived:   canonicalSpanSchema,
  topicAssigned:  topicAssignmentSchema,
  originResolved: originResolutionSchema,
} as const;
```

The persisted type string derives from the pipeline name, the optional prefix
and the snake-cased map key. The payload type derives from the schema. The set a
router filters on derives from the map. None of those is written a second time.

State is not part of the vocabulary, because state belongs to whatever
accumulates it. A pipeline may have several folds or none.

### 4. `.id()` is the aggregate identity, it is exhaustive, and `.build()` returns it

Declared per event, as a map exhaustive over `.events()`:

```ts
.id({
  spanReceived:    (data) => data.traceId,
  logContributed:  (data) => data.parentTraceId,
  annotationAdded: (data) => `${data.projectId}:${data.traceId}`,
})
```

Each extractor is typed against its own event's payload, so it reaches the
fields that event actually has — no union to narrow, no `in` check, no cast. Two
events assembling the id differently sit next to each other where the difference
is visible.

**Exhaustive**, because an event with no extractor is telling you something: its
schema is missing a field, or it belongs to another pipeline and should cross as
a command (decision 12), or it describes work spanning many aggregates and
should be fanned out into one event per aggregate by the command that emits it.

**`.build()` returns the map, and the engine is the only thing that applies
it.** `BuiltPipeline` carries `aggregateIdFor(eventType, payload)`. The
dispatch plane calls it to name a fold's lane and a process manager's instance;
the fold executor receives the same value as its row key. There is no second
derivation, no `*GroupKey` helper in a pipeline directory, and no way for a
lane and a row key to disagree — they are one call.

This is the rule the previous three documents each assumed another one enforced.
It is enforced by a test that builds every registered pipeline and asserts every
declared event resolves an id.

**A fold may refine its row key below its lane, and never above it.** The first
draft of this decision said `.id()` *is* the lane and the row key, one fact
serving two purposes. That is true whenever a pipeline's accumulators all share a
grain, which is the common case — and false for langy, which is the case that
found it. Its spine fold accumulates per conversation, its turn fold per turn,
and the two subscribe to an overlapping set of events. Neither single id works:
`conversationId` gives the turn fold one row per conversation, collapsing every
turn onto the last one written, and `${conversationId}:${turnId}` gives the spine
fold a lane per turn, so two turns of one conversation apply concurrently to one
row — the lost update decision 14 refuses.

So the lane and the row key are separated, with the direction fixed:

```ts
.withFold("conversationTurn", {
  key: (aggregateId, data) => `${aggregateId}:${data.turnId}`,
  …
})
```

`.id()` gives the lane, and the row key defaults to it. A fold may declare `key`
to refine that key *within* the lane, and the refinement must have the lane id as
its prefix — which is what makes "finer than the lane" checkable rather than
trusted. A coarser lane is always safe: every row the lane can reach is
serialised through it, so mutual exclusion still holds over the finer key, at the
cost of less parallelism than the grain would allow. A finer lane is never safe,
and the prefix rule makes it unrepresentable.

The alternative was a second pipeline fed by a command bridge, which decision 13
would require since the keys differ. It is more faithful to the one-aggregate-
per-pipeline shape and it was rejected on cost: it writes every turn event into
`event_log` twice and leaves the turn fold unable to replay from the original
stream. Paying double the highest-volume write to avoid one declared field is the
wrong trade.

### 5. Handlers are keyed by event, never switched over event

Every member's `on` is a map from event key to handler, and the payload arrives
already typed as that event's own schema. There is no discriminant to plumb, no
narrowing, and no cast. Type guards have nothing left to do.

Exhaustiveness is not required. An event with no declared handler is a no-op: a
fold returns the state it was given, a map returns no row, a process manager
runs no step at all — leaving its state, its intents and its armed deadline
exactly as they were, because there is no `nextWakeAt` a manufactured no-op
could return that is always right except "do not touch it".

### 6. Two kinds of projection, and the axis is where the accumulator lives

- **`map`** — no accumulator. Each event independently produces rows. Batching
  is an execution detail: a batched map and an event-at-a-time map produce the
  same rows.
- **`fold`** — the accumulator lives in the row. Read prior state, apply, write
  back.

The datasource does not enter into it. A fold over Postgres is a fold; a map
into ClickHouse is a map. There is no third kind: a "state projection" whose
store is a `load`/`store` pair is a fold with a `replace` store, and giving it
its own registry, executor and replay path bought a narrower contract rather
than a different kind.

### 7. Nothing on the delivery path reads the event log

The line is precise, because the two operations look alike and cost
differently:

- Reading your own last-committed projection row back is a **point read on the
  projection's own table**. It stays. It is how a cold cache recovers, and it is
  bounded by the aggregate's row, not its history.
- Replaying events out of `event_log` is **refolding**. It happens only in an
  explicit offline replay (ADR-108), the sole bulk reader of the log.

So refold-on-store-miss, refold-on-out-of-order, the per-delivery decision of
whether to refold, and the bounded event loader are all absent — not disabled,
absent. A fold that needs continuity earns it by persisting enough typed state
to reconstruct its accumulator, which is a requirement on the fold's state
design rather than a runtime option.

With no refold, a fold's per-delivery work is one point read, one apply and one
write, regardless of how many events the aggregate has accumulated.

### 8. Every fold is order-invariant and idempotent, and `+=` is banned

Delivery order is not a contract. The queue orders a lane's jobs by their
ordering key and pops the lowest, so events queued *together* are applied in
that order — but an event arriving after a lower-scored sibling was already
popped is applied late, and nothing rewinds. Order is a convergence
accelerator, not a guarantee, and it could not be one even if the queue were
stricter: telemetry is stamped in a customer's process and crosses a network, so
the stream is unordered before we receive it.

So the requirement moves to the fold. Every field of a fold's state is one of:

- **commutative and associative** — `sum`, `count`, `min`, `max`, set union.
- **monotone by rank** — `status = max(current, incoming)` over a declared
  lattice. A legal regression, such as a rerun or a cancellation after
  completion, is a new *generation*, not a downward step; without that the
  lattice forbids a transition the domain allows, which is how a cancelled run
  gets resurrected as a success.
- **last-write-wins by time** — ordered on the row's latest-applied-event
  stamp, tie-broken bytewise by event id. Never on `acceptedAt`, which is frozen
  for the row's life and so cannot order anything, and never on `occurredAt`,
  which a skewed customer clock can win permanently.

Redelivery therefore needs no guard. There is no sequence column on a
projection row, no last-applied event id, and no skip branch in the executor: a
redelivered job is applied again and reaches the state it already had. A set
does not count multiplicity, so `+=` is inadmissible — a delta is an **item
row** keyed by its natural key, collapsed by the storage engine, with the total
derived at read time (ADR-103).

Event-id comparison is bytewise. Never `localeCompare`: ICU collation inverts
base62 KSUIDs at the `Z` → `a` step, so two workers would order the same pair
differently and neither would agree with ClickHouse's byte ordering of a
`String` column.

**The property is checked, not asserted.** `checkOrderInvariance` sweeps every
permutation of the event set *and* the re-application of each event, and reports
`duplication` distinctly from `order` because the remedies differ: an ordering
failure wants a stamp or a rank, a duplication failure wants item rows. Every
fold calls it over a realistic event set in its own unit tests. Ordering guards,
backdated-event detection and monotonic clamps written *inside* a fold are
deleted; what replaces them is a state model in which they are unnecessary.

### 9. A read has three outcomes, and undecodable is not genesis

1. **State found.** Which tier served it is invisible to the caller and visible
   in the metrics.
2. **Genuinely absent.** No row for this aggregate. This is genesis: `init()`.
3. **Present but undecodable.** A row is there and this build cannot read it.
   The job fails, retries on its budget, and surfaces to an operator.

The third must never collapse into the second, and the failure it prevents is
the most dangerous one available in this design. A deploy changes a fold's
shape; every committed row for that fold fails to decode, not one aggregate but
the whole population on the first pod that rolls; each is read as absent; each
is overwritten with a fresh accumulator stamped at the *current* version, which
the decoder that just rejected the old row accepts happily from then on. The
corruption launders itself — the row reads clean, the metrics are quiet, and
the original state is gone, with no signal afterwards distinguishing a counter
that legitimately restarted from one whose history was discarded.

A store that can refuse a row it found must say *why* it returned nothing.
`absent` and `undecodable` are distinct answers.

### 10. Durable store first, cache second, and a failed cache write deletes the key

The order is fixed: commit to the durable store, then write the cache. A failed
cache write **deletes** the key rather than logging and leaving what is there. A
stale entry is worse than no entry by exactly the amount that matters: the next
read serves superseded state, the fold applies the next event to it, and commits
a newer version of wrong state. The delete is best-effort in the same sense the
write was; if it also fails, the entry's TTL bounds the damage.

A cache that is unreachable fails open to the durable store. An unreadable or
absent entry is a miss, not an error. The cache is a latency tier: losing it
costs latency and the read-your-writes window, not correctness.

### 11. A fold's version is the hash of its state schema, and every live fold pins

The version stamped on every row derives from a normalised hash of the state
schema — keys sorted, types only, descriptions excluded. It is therefore
impossible to change what a fold stores and not move its stamp, which is the
failure that lets a stale row decode into wrong state. A hash is legal as a
version because ADR-109 never orders version strings: a stamp is compared for
equality and positioned by its index in an append-only list.

An explicit `pin` overrides the value without disabling the check — the
snapshot records the pin **and** the computed hash, so a shape change under an
unchanged pin fails. **Every fold with rows already in production pins its
current stamp, without exception**: the day derived versions ship, an unpinned
fold fails its version gate on every live row at once, because no stored date
matches a freshly computed hash.

The version belongs to the fold rather than the pipeline, because it stamps what
the fold stores. Three folds over one vocabulary have three unrelated state
shapes and three independent reasons to move.

A store must version-gate its read-back. A fold whose `get()` ignores the stamp
decodes an old row into defaults and commits permanently wrong state, which is
decision 9's hazard arriving through the store instead of the decoder.

**A process manager cannot pin yet, and saying it must was an error.** The
builder derives a state version for a process manager exactly as it does for a
fold, so the machinery reads as symmetric — but `ProcessManagerInstance` has no
version column, no previous implementation ever wrote one, and no migration ever
added one. There is therefore no stamp on a live process-manager row to pin *to*,
and any value written into `pin` would be an invented string presented as a
persisted one, which decision 12 forbids for precisely the reason it would be
wrong here.

Nothing reads a process manager's derived version today, so no gate can fail
either. The order is: the store adds a version column that treats `NULL` as a
legacy row it accepts and stamps on next write; only then does pinning mean
anything, and only then does the version gate extend to process managers. Until
that lands, the eight live process managers are deliberately unpinned, and this
paragraph is the record of why rather than a gap someone should close by
guessing.

### 12. Derived type strings are ratcheted once, over events and intents together

Renaming a key in `.events()` or in an intent map changes a string written into
`event_log` or an outbox row and read back for the whole retention window.
Nothing in the type system notices, because the union changed consistently with
itself.

So the derived strings are snapshotted into **one** committed file, produced
from the registry rather than per pipeline, and a test fails when a string
*disappears*. Additions are free; a removal or a rename is a diff a reviewer
reads.

One implementation, one snapshot, and it walks **both** event types and intent
types for **every** registered pipeline. Nine per-pipeline ratchet modules, of
which seven walked events only and three pipelines had none at all, is nine
places for the tenth pipeline to be forgotten. Driving it from the registry
means a pipeline cannot be registered without being ratcheted.

Persisted strings are the truth: an existing event's string is never re-minted
in a new format, and no new-to-old translation map exists. Prefix and
snake-case derivation must reproduce the legacy `lw.*` strings byte-for-byte.

### 13. Crossing pipelines needs a command bridge exactly when the aggregate key changes

- **Keys differ → a command bridge is required.** The bridge *is* the re-key,
  and the re-key is what restores per-aggregate serialisation on the far side.
  Without it the target's events arrive grouped by the source's key and the
  target's folds lose the lane decision 8 relies on for convergence.
- **Keys match → subscribe to the source's events directly.** A bridge there
  buys a schema boundary and nothing else.

Cross-pipeline subscription is not expressible in a declaration: an `on` record
can only key on the map `.events()` fixed. A pipeline that needs another's
events takes them as a command. The cost lands on genuinely cross-cutting work
— a meter spanning four vocabularies becomes its own pipeline fed by command
bridges rather than a projection reaching sideways.

### 14. The mount checker is one function, and these are the refusals

Every rule about a *combination* of independently-declared properties lives in
one checker, called where a pipeline is assembled, so an illegal mount fails a
deploy rather than a customer's numbers. Each rule below is decidable before a
single event is processed, and each has a silent failure mode — which is what
makes it worth a compile-time answer rather than a runbook.

| combination | refused because |
| --- | --- |
| `fold` + scope other than `aggregate` | two concurrent applies to one aggregate lose an update, and no read-time dedup recovers it |
| `fold` + `collapse: latest` | a fold accumulates, so a discarded event is a contribution that never arrives |
| `fold` + a store other than `replace` | a fold reads its prior state back, which only a `replace` store offers |
| `map` + `replace` | no executor accepts it, and no adopter exists |
| scope `event` + a batch size above 1 | a lane holding one event can never form a batch, so the setting is a no-op that reads as an optimisation |
| `merge`, at all | the kind is closed — see below |

**Every rule is now decidable, which is the second thing the merge fixes.**
ADR-106 decision 3 recorded that `.build()` could enforce only two of its four
rules, because scope and collapse were dispatch-plane facts assigned outside the
declaration — so a pipeline that built was not thereby a pipeline whose lane had
been checked, and eight pipelines each hand-rolled a private wrapper to close
the gap while three forgot to. Under decision 1 the scope is declared at the
mount, so the checker sees every input and runs once, in the engine.

**`merge` is closed, and the checker carries no grandfathering.**
`AggregatingMergeTree` combines rows *by the sort key*, so the usual fix for
non-idempotent redelivery — a per-write discriminator in the key — stops two
writes ever sharing a key and never combining. The result is one row per write:
an append table wearing a rollup's name. A `merge` store's non-idempotency is
not a gap to be guarded; it is what the engine is. The three tables that exist
are named debt with a stated exit in ADR-109, and each leaves by a `replace`
store written with the whole bucket value or by derivation at read time.

### 15. A command is the trust boundary, and its work is a function of its input

`handle` is async and does real work: validating, normalising, redacting,
enriching. That belongs there rather than downstream because the command is the
last point raw customer input exists before it becomes a durable row held for
the whole retention window. Scrub after that and you have retained the thing you
were scrubbing.

It must be deterministic in its input. A retried command runs `handle` again; if
its enrichment is not a function of `input`, the retry mints a *different* event
for the same input and both land — and decision 8 buys idempotence from a fold
being a function of the set of its events, which two events that should have
been one defeats. So no clock, no random, no minted id, and no database read
whose answer can change between attempts. Where a decision genuinely requires
accumulated state, the command names the fold it reads from.

The event payload is serialised **once**, here, and that same string is what
reaches the event log, the job body and replay (ADR-108).

### 16. An intent declares its payload, its key and its delivery together

```ts
intents: {
  notifyDigest: {
    payload:    digestSchema,
    messageKey: (p) => `digest:${p.traceId}`,
    deliver:    (payload, ctx) => deps.notifier.send(payload),
  },
}
```

`messageKey`'s only input is the declared payload. It cannot reach the clock,
and it cannot reach state the payload did not declare — the two ways a key stops
collapsing redeliveries. A key built from the current time is fresh on every
retry of the same logical intent; a key built from a value the process was
holding but never declared lets two evolutions of the same intent compute
different keys and both dispatch.

The restriction is on the parameter, and it is not sufficient on its own: a
clock value that reaches the key *through* a declared field defeats it just as
completely. An intent whose identity depends on when the event happened carries
the event's own instant on its payload, stamped by the command, never read from
the runtime clock at step time.

An intent type string is `${processManagerName}/${key}`, qualified because the
outbox is shared: two processes each naming an intent `notify` would otherwise
mint the same type into a table one dispatcher indexes by type alone.

### 17. Where the code lives

```
trace-processing/
  events.ts                    the vocabulary
  schema.ts                    payload and state schemas
  table.ts                     defineTable definitions
  recordSpan.command.ts        a command's handler
  traceSummary.projection.ts   a fold's init and handlers
  spanStorage.projection.ts    a map's row builders
  traceSettlement.process.ts   a process manager's step handlers
  index.ts                     the chain — the only file naming a client
```

Each mount is a record literal held directly in `index.ts`, not assembled by
calling into the file it names. Handler bodies live in sibling files, which may
import `events.ts` and `schema.ts` and never `index.ts`. What `deps` carries is
collaborators — a client, a cache, a notifier, a flag — never members: a
pipeline whose projections arrive through a `Deps` interface has stated its
wiring somewhere else, and the one file stops being the answer.

The single acknowledged exception is enterprise members. `ee/` cannot be
imported unconditionally from an open-source pipeline file, so enterprise mounts
cross as injected values behind an `if` guard. **The builder must therefore
accept a pre-built member**, not only a literal: the previous mount surface
offered no such shape, which is why five enterprise mounts had no expression in
the new declaration and were simply absent. The exception is scoped to the
OSS/EE boundary and is not a precedent for injecting anything else.

## Rationale / Trade-offs

**Why merge three ADRs rather than fix the two contradictions?** Because both
contradictions were *between* documents, and neither document was wrong on its
own. ADR-106 reasoned correctly about what a builder could decide, from a
premise about the builder that was false. ADR-105 specified a map the builder
ignored. A boundary that produces defects only in the gaps between correct
documents is the wrong boundary, and the cost of the split — three places to
look for one answer — bought nothing, since no rule here is useful without the
other two.

**Why does the engine own the id derivation rather than the dispatch plane
reading `.id()` itself?** One call site, so a lane and a row key cannot come
from different code. Handing the map to the dispatch plane and the row key to
the executor is two readers of one declaration, which is the shape that failed.

**Why declare scope at the mount rather than at the dispatch plane?** Because
the mount is the only place that knows what the projection *is*. Scope decides
what is ordered against what and what may batch, and those are properties of
the projection's semantics, not of the deployment. Assigning them outside the
declaration is precisely what made two thirds of ADR-106's rules undecidable
and produced eight copies of a private checker.

**Why hash the state schema rather than require a bump and lint for it?** A lint
for "you changed the state and did not change the version" has to know what
counts as a change to the state, which is the hash. Given the hash, the version
is free and the lint is redundant.

**Why one ratchet snapshot rather than one per pipeline?** Because the failure
mode is a *missing* ratchet, and per-pipeline files make that invisible: three
pipelines had none and nothing failed. A registry-driven snapshot cannot omit a
registered pipeline.

**Why no dedup mechanism at all, rather than a good one?** Every candidate makes
correctness depend on machinery outside the fold. A bounded ring of recent event
ids has a window, so an older redelivery is double-applied and nothing detects
it. An event-time watermark cannot tell a late arrival from a redelivery, and
decision 8 makes late arrival normal, so it would discard genuinely new events.
A per-row delivery sequence has neither flaw but buys idempotence for a fold
that has not earned it: with the guard in place a `+=` field passes review, and
the guard is the only thing between it and a double count on the first retry.

**What this costs: legibility.** A reader can no longer grep
`"lw.obs.trace.span_received"` and land on its declaration. The committed
snapshot contains every derived string and the ratchet names each one in its
failure message, which softens it without restoring it.

**And type errors before they get better.** A mistake inside a chain this dense
can surface as a failure in an inferred union rather than at the line that
caused it. Handler bodies stay ordinary functions with explicit parameter types
for exactly this reason.

## Consequences

- **Roughly twenty `*GroupKey` helpers are deleted**, along with the class of
  defect where a lane and a row key disagree. One verified instance existed: a
  fold declaring `conversationId` while its store parsed
  `${conversationId}:${turnId}`, which would have collapsed every turn of a
  conversation into one row had the id map been live.
- **Eight copies of a private mount checker are deleted**, and the three
  pipelines that never had one are covered, because the checker now runs in the
  engine with every input in scope.
- **Nine ratchet modules become one**, and the three unratcheted pipelines stop
  being unratcheted.
- **`map` + `replace` is refused in both artefacts.** The legal-shape
  enumeration loses twelve rows it should never have carried.
- **The builder gains a pre-built-member mount**, which is what the enterprise
  seam needs and what its absence cost: five enterprise mounts — trace-sourced
  trigger matching, gateway budget debits, virtual-key last-used, governance
  KPIs and the OCSF audit stream — had no representable shape.
- **A whole class of silent corruption closes by construction**: a fold's stamp
  cannot fail to move when its state shape moves.
- **A previously silent corruption becomes a loud failure.** Reading a found-
  but-refused row as absent could overwrite a fold's whole population
  undetectably; it now fails the delivery. A genuine schema mistake takes a
  fold's queue down instead of quietly resetting it, which is the correct trade.
- **Three mount points collapse to two**, and the third kind's separate
  registry, executor and replay path go with it.
- Adoption is version-gated and unforgiving in one direction: decision 11's pins
  are load-bearing on the first deploy, not tidy-up afterwards.

## References

- `packages/event-sourcing/src/pipeline/definePipeline.ts` — the chain, and the
  guards that keep a declaration routable.
- `packages/event-sourcing/src/pipeline/typeStrings.ts` — the derived event and
  intent strings, and the shared snake-casing both use.
- `packages/event-sourcing/src/pipeline/ratchet.ts` — decision 12's snapshot.
- `packages/event-sourcing/src/mount/validateMount.ts` — decision 14's table.
- `packages/event-sourcing/src/projections/orderInvariance.ts` — decision 8's
  check.
- `specs/event-sourcing/pipeline-declaration.feature`,
  `specs/event-sourcing/fold-execution.feature`,
  `specs/event-sourcing/mount-contract.feature`,
  `specs/event-sourcing/type-string-ratchet.feature`.
- ADR-108, ADR-109, ADR-110, ADR-103.
