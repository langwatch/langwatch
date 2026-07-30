# ADR-105: A pipeline is one declaration

**Date:** 2026-07-30

**Status:** Accepted — this is the shape a pipeline is declared in. There is no
second one.

**Builds on:** ADR-098 (the two projection kinds, ordering as best effort, and
why redelivery needs no guard), ADR-099 (`defineTable` and the three store
kinds), ADR-100 (the group key and its scopes), ADR-102 (the package boundary —
this declaration lives in `packages/event-sourcing`, the stores it mounts do
not), ADR-106 (the mount checker, which refuses illegal combinations of what
this declares).

## Context

A pipeline is a small amount of domain logic surrounded by a large amount of
restating. The measurement that matters is the ratio inside one event.

Take `lw.experiment_run.started`. Its payload is 7 lines. Wrapping it costs 6
more for an envelope and 3 for a type export, before its persisted type string,
its version and its membership in the array a router filters on are each written
somewhere else again — four sites for one event, plus a fifth platform-wide
registry that hand-lists the aggregate it belongs to. Repeated across the 72
payload-extension sites in `langwatch/src` and `langwatch/ee`.

The aggregate totals: 11 `schemas/` directories holding 3,838 lines, of which
1,794 are payload declarations, 805 are type-string and version constants, and
259 are type guards doing nothing but `event.type === CONSTANT` narrowing.
Almost none of it is logic.

Each restatement is a place two declarations can disagree, and the disagreements
are not hypothetical. One session id was derived in three different places and
split a customer's session across two aggregates. A fold's state shape changed
without its hand-typed version moving, so one stamp came to span two row shapes
and the stamp alone could no longer decide whether a row was safe to decode —
that fold ended up carrying three version constants and sixty lines of
archaeology explaining which was which.

The same shape appears on the durable-work side. An intents map paired with a
hand-maintained constant map of its own keys, proved consistent by `satisfies`
at the moment both were written and never again — while `intentType` is a column
read back from an outbox until a message is delivered, so a renamed key orphans
a row exactly the way a renamed event key orphans an `event_log` row.

And a message key was built from a value the payload never declared —
`` `persist:${traceId}:${bucket}` `` where the payload held only
`{ triggerId, traceId }`. Two evolutions that were the same logical intent could
compute different keys and both dispatch.

Every one of these is the same defect: a fact stated twice, with nothing
structural keeping the statements equal.

## Decision

### 1. A pipeline is one chain

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

    .withCommand("recordSpan", (c) => c
      .input(rawSpanSchema)
      .handle(recordSpan(deps)))

    .withFold("traceSummary", (f) => f
      .state(traceSummaryStateSchema, initTraceSummary)
      .on({ spanReceived: applySpanReceived, topicAssigned: applyTopicAssigned })
      .store(clickhouseReplacing({
        client: deps.client,
        table: traceSummaryTable,
        cache: deps.summaryCache,
      })))

    .withMap("spanStorage", (m) => m
      .on({ spanReceived: toSpanRow })
      .store(clickhouseAppend({ client: deps.client, table: storedSpansTable })))

    .withProcessManager("settlement", (pm) => pm
      .state(settlementStateSchema, initSettlement)
      .intents({
        notifyDigest: {
          payload: digestSchema,
          messageKey: (p) => `digest:${p.traceId}`,
          deliver: (payload) => deps.notifier.send(payload),
        },
      })
      .on({ spanReceived: onSpanReceived })
      .onWake(onSettlementDue)
      .enabled(deps.flags.traceSettlement))

    .build();
}
```

Everything the pipeline is, is in that file: its vocabulary, its identity, its
members, and the infrastructure each member writes to. Nothing about it is
stated anywhere else.

### 2. Five members, one mount shape

Every member mounts as `.withX(name, builder)`. The name is the member's
identity in metrics, logs and stored rows; the builder is a callback handed a
chain already typed against `.events()`.

| member | accumulates | writes to | gets a context |
| --- | --- | --- | --- |
| `.withCommand` | nothing | the event log, via the events it returns | yes |
| `.withFold` | state, read back before each apply | a `replace` store | no |
| `.withMap` | nothing | an `append` store | no |
| `.withProcessManager` | state, and a wake deadline | a `replace` store and the outbox | yes |
| `.withSubscriber` | nothing | whatever it calls | yes |

The two kinds of projection are ADR-098's, and the axis is unchanged: a fold
reads its prior state, a map does not. A process manager is a fold that also
emits intents and arms a deadline; a subscriber is at-most-once work that may be
lost without consequence.

### 3. The vocabulary is `.events()`, and an event is its payload schema

```ts
export const traceEvents = {
  spanReceived:   canonicalSpanSchema,
  topicAssigned:  topicAssignmentSchema,
  originResolved: originResolutionSchema,
} as const;
```

That is the entire declaration of an event. Its persisted type string derives
from the pipeline name, the optional prefix and the snake-cased map key. Its
payload type derives from the schema. Its membership in the set a router filters
on derives from the map. None of those is written a second time.

State is not part of the vocabulary, because state belongs to whatever
accumulates it. A pipeline may have several folds, or none — three folds over
one event vocabulary is ordinary, and a pipeline that only writes item rows
accumulates nothing at all. Attaching one state to the vocabulary would
privilege one accumulator over its peers, and would oblige a pipeline with no
accumulator to invent one.

### 4. `.id` is the aggregate identity, and the chain asks for it exactly when something needs it

`.id` extracts the aggregate id from an event's payload. It is one fact serving
two purposes that are the same purpose: it is the **lane** — ADR-100 scopes a
fold's mutual exclusion to `{ aggregateType, aggregateId }`, because two
concurrent applies to one aggregate lose an update no read-time dedup recovers —
and it is the **row key** a fold reads back and writes. A fold keyed by anything
other than the thing its lane is keyed by is that lost update wearing a
different name, which is why ADR-106 refuses the combination and why there is
only one id to give.

It is declared **per event**, as a map exhaustive over `.events()`:

```ts
.id({
  spanReceived:    (data) => data.traceId,
  topicAssigned:   (data) => data.traceId,
  logContributed:  (data) => data.parentTraceId,
  annotationAdded: (data) => `${data.projectId}:${data.traceId}`,
})
```

Each extractor is typed against its own event's payload, so it reaches the
fields that event actually has — no union to narrow, no `in` check, no cast. An
id assembled from several fields is written where those fields are in scope, and
two events assembling it differently sit next to each other where the difference
is visible.

**Exhaustive**, because an event with no extractor is telling you something: its
schema is missing a field, or it belongs to another pipeline and should cross as
a command (ADR-098 §9), or it describes work spanning many aggregates and should
be fanned out into one event per aggregate by the command that emits it. Bulk
shapes live in a command's input, never in an event. Adding an event without
saying how it identifies its aggregate does not compile.

Divergent spellings are not a hypothetical to design around later: events
already written carry whatever field names they were written with for the whole
retention window, and no rename reaches them. The map is where that history
lives — one place, greppable, and complete. New events have no excuse for
diverging, because the vocabulary is ours: a caller's field names are normalised
in `handle` and never reach an event schema.

`.id` is required exactly when a member needs it. `.withFold` and
`.withProcessManager` are offered only on a chain that has fixed `.id`; a
pipeline of maps alone is never asked for one, because a map's row carries its
own key and a map needs no mutual exclusion.

### 5. Handlers are keyed by event, never switched over event

Every member's `.on({ … })` is a map from event key to handler. The payload
arrives already typed as that event's own schema, so there is no discriminant to
plumb, no narrowing, and no cast. Type guards have nothing left to do.

Exhaustiveness is not required. A member typically responds to a handful of a
pipeline's events, and an event with no declared handler is a no-op: a fold
returns the state it was given, a map returns no row, a process manager runs no
step at all — leaving its state, its intents and its armed deadline exactly as
they were, because there is no `nextWakeAt` a manufactured no-op could return
that is always right except "do not touch it", which is a decision not to run a
step rather than a value a step can return.

Subscribing to an event the pipeline does not declare is unreachable: the
builder can only key on the map `.events()` fixed.

### 6. Collaborators arrive by construction, at the mount

A handler that needs a redactor, a notifier or a repository is constructed with
one, on the line that mounts it:

```ts
.withCommand("recordSpan", (c) => c.input(rawSpanSchema).handle(recordSpan(deps)))
.withFold("traceSummary", (f) => f.state(…).on({…}).store(clickhouseReplacing({ client: deps.client, … })))
```

Those two lines are the same shape. A store is built from `deps` at the mount
and handed to `.store()`; a handler is built from `deps` at the mount and handed
to `.handle()`. There is one way collaborators reach a pipeline's members, and
it is the way the store already did.

The pipeline itself therefore takes no dependencies. There is no context type
parameter, because `deps` is already in scope in the function that declares the
pipeline — threading it a second time through the chain would be a parallel
channel for something the mount can already see, and a parallel channel is what
this ADR removes everywhere else.

`.build(ports?)` takes one optional argument, and the distinction it rests on is
worth stating because it is exactly the distinction that was lost the first time.
A **port** is one capability the whole pipeline observes through, identical for
every member, that the members themselves never choose — the metrics registry is
the case, and today the only one. A **dependency** is a collaborator one member
needs to do its job: a redactor, a notifier, a repository. Ports arrive at
`.build()`; dependencies arrive at the mount. If a second field is ever proposed
for `ports`, the question to ask is whether any individual mount would want a
different one — if it would, it is a dependency, and it belongs at the mount.

Metrics are supplied here rather than per mount because a per-projection
`.metrics(...)` would be a fourth thing to remember on every declaration, and
forgetting it is silent: the projection still works, it just stops being
observable. `noopMetrics` covers absence, so the argument stays optional.

What a handler *is* given is the small set of facts only the runtime knows and
nothing can inject: the current time, the tenant, and a process manager's own
wake state. Those are identical for every pipeline, so they need no type
parameter and no declaration.

Fold and map handlers receive `(state, data)` and `(data)` respectively —
nothing more. That is how ADR-098 §3, nothing on the delivery path reads the
event log or does I/O, stops being a rule and becomes a shape: a fold cannot
make a call it has nothing to make a call with, and no mount hands it one.

### 7. A command is the trust boundary, and its work is a function of its input

`handle` is async, and it does real work: validating, normalising, redacting,
enriching. That belongs there rather than downstream because the command is the
last point raw customer input exists before it becomes a durable row held for
the whole retention window. Scrub after that and you have retained the thing you
were scrubbing.

It must be deterministic in its input. A command that is retried runs `handle`
again; if its enrichment is not a function of `input`, the retry mints a
*different* event for the same input and both land. ADR-098 §5 buys idempotence
from a fold being a function of the set of its events — two events that should
have been one defeats it, and no downstream mechanism can tell.

A command decides from its input alone. Where a decision genuinely requires
accumulated state, the command names the fold it reads from; that is a
declaration, not an ambient parameter every handler receives whether it uses one
or not.

### 8. An intent declares its payload, its key and its delivery together

```ts
.intents({
  notifyDigest: {
    payload:    digestSchema,
    messageKey: (p) => `digest:${p.traceId}`,
    deliver:    (payload, ctx) => ctx.notifier.send(payload),
  },
})
```

Three facts about one thing, in one place. A declared intent with no delivery
does not compile, and a delivery for an intent nobody declares has nowhere to
go.

`messageKey`'s only input is `z.infer<payload>`. It cannot reach the clock, and
it cannot reach state the payload did not declare — the two ways a key stops
collapsing redeliveries. A key built from `ctx.now` is fresh on every retry of
the same logical intent; a key built from a value the process was holding but
never declared lets two evolutions of the same intent compute different keys and
both dispatch. Restricting the parameter makes both unrepresentable, and applies
a useful pressure besides: an intent's identity has to be visible in its own
schema.

An intent type string is `${processManagerName}/${key}`, qualified by name
because the outbox is shared across every process manager — two processes each
naming an intent `notify` would otherwise mint the same `intentType` into a
table one dispatcher indexes by type alone.

### 9. A fold's version is the hash of its own state schema

`.state(schema, init)` derives the version stamped on every row from a
normalised hash of that schema — keys sorted, types only, descriptions excluded.
It is therefore impossible to change what a fold stores and not move its stamp,
which is the failure that lets a stale row decode into wrong state.

A hash is legal as a version because ADR-099 never orders version strings: a
generation's stamp is compared for equality and positioned by its index in an
append-only list, so nothing depends on the value looking like a date.

An explicit pin overrides the number without disabling the check — the snapshot
records the pin **and** the computed hash, so a shape change under an unchanged
pin fails. Every fold with rows already in production pins its current stamp on
adoption, without exception: the day derived versions ship, an unpinned fold
fails its version gate on every live row at once, because no stored date matches
a freshly computed hash.

The version belongs to the fold rather than the pipeline because it stamps what
the fold stores. Three folds over one vocabulary have three unrelated state
shapes and three independent reasons to move.

### 10. Derived type strings are ratcheted, because events are persisted forever

Renaming a key in `.events()` or `.intents()` changes a string written into
`event_log` or an outbox row and read back for the whole retention window.
Nothing in the type system notices, because the union changed consistently with
itself.

So the derived strings are snapshotted into a committed file, and a test fails
when one *disappears*. Additions are free; a removal or a rename is a diff a
reviewer reads. One implementation covers both kinds — the snapshot is keyed by
declaration name and compared the same way whether the strings are events or
intents.

### 11. Handlers return new state

No mutative-looking reducers, no proxies. Fold states here are the working state
of a whole trace or session and sit on the hot delivery path, where every event
would pay for the proxy. Immutable returns also keep a handler a pure function
of `(state, data)`, which is what ADR-098's order-invariance check asserts
against — and that check is the thing standing between a fold and a silent
disagreement under reordering, so it is worth keeping cheap to run.

### 12. Where the code lives

The chain holds names, schemas and stores. Handler bodies live in files beside
it.

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

A handler outside the chain takes explicit parameter types. That is the trade
decision 11 already makes: an ordinary function fails at the line that caused
the mistake, rather than inside an inferred union three types away.
`index.ts` may import from its own directory and from the two packages; nothing
in the directory imports `index.ts`.

## Rationale / Trade-offs

**Why a chain rather than one object literal?** Because each step's types depend
on the step before it. `.events()` is what makes every handler below it typed
with no annotations, and `.id()` is what makes `.withFold` available at all. A
literal has no ordering to hang that on, so the same guarantees would have to be
runtime checks over an object's shape after the fact. The chain also makes
illegal states unreachable rather than merely refused: a fold on a pipeline with
no identity is not a mistake you can write.

**Why derive the type string from the key rather than author it?** Because the
artefact a developer reads should be the one they wrote. Deriving removes three
of four declaration sites per event and makes disagreement between them
unrepresentable rather than merely tested for.

**Why hash the state schema rather than require a bump and lint for it?** A lint
for "you changed the state and did not change the version" has to know what
counts as a change to the state, which is the hash. Given the hash, the version
is free and the lint is redundant.

**Why a committed snapshot rather than generating the strings into a file?** A
generated file drifts silently when generation is skipped, and reviewing it is
reviewing an output. The snapshot's whole job is to be small, greppable, and
diffed by a human at exactly the moment a persisted identifier would change.

**Why not derive the pipeline name from its directory?** It would make renaming a
folder a data migration. The name is a persisted identifier — it appears in
`event_log`, in group keys, and in every stored aggregate type.

**What this costs: legibility.** A reader can no longer grep
`"lw.obs.trace.span_received"` and land on its declaration. Two things soften it
and neither restores it fully: the committed snapshot is a plain file containing
every derived string, and the ratchet names each string in its failure message.
Someone looking for where an event is *defined* has to know to look for the
pipeline and the camelCase key.

**And type errors before they get better.** A mistake inside a chain this dense
can surface as a failure in an inferred union rather than at the line that caused
it. Decision 11 keeps handlers ordinary functions with explicit parameter types
for exactly this reason, and decision 12 puts the ones with any weight in files
of their own.

**Type-level cost is a real constraint.** One mapped type per axis, and no
recursive conditional type over the event union — the union stays linear in the
number of events. Snake-casing is the single recursion, and it walks one
identifier's own characters rather than the union, so N events pay N bounded
walks rather than N compounding ones.

## Consequences

- Three of four declaration sites per event disappear, along with the type-guard
  files and the alias files. Most of the 3,838 lines measured above is output,
  not source.
- A whole class of silent corruption closes by construction: a fold's stamp
  cannot fail to move when its state shape moves.
- A pipeline with no accumulator declares no state, and a pipeline with three
  declares three peers. Neither has to invent or privilege one.
- A fold and a map cannot do I/O, because neither is handed anything to do it
  with.
- A process manager's intent cannot be declared without saying how it is
  delivered and how a redelivery of it collapses.
- Cross-pipeline subscription is not expressible. A pipeline that needs another's
  events takes them as a command (ADR-098 §9). The cost lands on genuinely
  cross-cutting work — a meter spanning four vocabularies becomes its own
  pipeline fed by command bridges rather than a projection reaching sideways.
- Adoption is version-gated and unforgiving in one direction: decision 9's pins
  are load-bearing on the first deploy, not tidy-up afterwards.

## References

- `langwatch/packages/event-sourcing/src/pipeline/definePipeline.ts` — the chain,
  and the guards that keep a declaration routable.
- `langwatch/packages/event-sourcing/src/pipeline/typeStrings.ts` — the derived
  event and intent type strings, and the shared snake-casing both use.
- `langwatch/packages/event-sourcing/src/pipeline/ratchet.ts` — decision 10's
  snapshot comparison.
- `langwatch/packages/event-sourcing/src/projections/orderInvariance.ts` — the
  check decision 11 keeps cheap.
- `langwatch/packages/clickhouse/src/stores/` — the store constructors a mount
  binds to, and the only other thing a pipeline file imports.
- `specs/event-sourcing/pipeline-declaration.feature` — the behaviour a
  declaration must satisfy.
- `specs/event-sourcing/order-invariance.feature`,
  `specs/event-sourcing/mount-contract.feature` — the two checks that run over
  what this declares.
- ADR-098, ADR-099, ADR-100, ADR-102, ADR-106.
