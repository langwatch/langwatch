# ADR-113: A pipeline owns a set of aggregates

**Date:** 2026-08-22

**Status:** Proposed

**Builds on:** ADR-110 (a grant is an aggregate, and so is a role),
ADR-100 (the aggregate-scoped lane), ADR-105 (an aggregate is one
declaration).

**Related:** the behavioural contract
[multi-aggregate-pipeline.feature](../../../packages/eventing/specs/multi-aggregate-pipeline.feature);
PR #7406, the fix this decision makes unnecessary.

## Context

A pipeline declares exactly one aggregate:

```ts
definePipeline({
  name: "authz_grant",
  aggregate: defineAggregate({ type: "authz_grant", events: [...] }),
})
```

ADR-110 split the authorization ledger into two aggregates — `authz_grant`
and `authz_role` — with distinct lifecycles, distinct ids and distinct event
vocabularies, and then had to put both on the one `authz_grant` pipeline,
because a pipeline is also the unit that owns a command queue, a set of
projections, a pause key and a replay scope. Splitting the pipeline to match
the aggregates would have meant two queues, two copies of the ledger fold and
two places for an operator to look at one feature.

The result was the bug #7406 fixes: role commands stamped `authz_role`, the
pipeline declared `authz_grant`, and the store rejected every role event at
index 0 of the first migration batch. #7406 makes the role commands stamp the
pipeline's type, and its constants file now reads "ONE aggregate TYPE for both
families, and it is not cosmetic. The type is the storage partition key."

That sentence is the reason for this ADR, because it is not what the code
does. The declared type is threaded from the pipeline through
`EventSourcingService.storeEvents` into `AbstractEventStore.storeEvents`, and
on that whole path it is used for exactly two equality checks. The row that
reaches ClickHouse is built by `eventToRecord`, which writes
`event.aggregateType` — the value the command stamped, not the value the
pipeline declared.

```
  command handler ── stamps event.aggregateType ──────────────┐
                                                               │
  EventSourcingService.storeEvents                             │
      if (event.aggregateType !== this.aggregateType) throw    │  assertion
                                                               │
  AbstractEventStore.storeEvents                               │
      validateEventAggregateType(event, aggregateType, i)      │  assertion
                                                               │
  eventToRecord(event)                                         │
      AggregateType: event.aggregateType  ◄────────────────────┘  the row
```

Everything downstream of the row is per event as well. Fold and map queue
groups are keyed `${event.aggregateType}:${event.aggregateId}`. Replay
discovers aggregates by event type and carries each one's own type out of the
log. Replay markers, fold-drain group ids and the process-manager inbox key
are all built from the event in hand. `processCommand` receives the
pipeline's type as a parameter and never reads it.

So the single-aggregate rule is a convention that the framework asserts, not
a property the storage layer relies on. The comment #7406 corrected — "the
declared type is a label, nothing routes on it" — was closer to the truth than
the code that replaced it. Meanwhile `EventCatalogue` already enforces the
invariant that would make a multi-aggregate pipeline unambiguous: every event
type belongs to exactly one aggregate, across the whole catalogue. Given an
event, its aggregate is never in doubt.

Four places do use the pipeline's declared type as a value rather than as an
assertion, and they are the whole cost of the change:

| Site | What it does with the type |
|---|---|
| `EventSourcingService` fold/map event loaders | closes over it to call `getEvents` / `getEventsUpTo` for a re-fold |
| `QueueManager` command registration | `${tenantId}:${aggregateType}:${aggregateId}` is the command queue group key |
| `ProjectionRouter` time-local gate | `TIME_LOCAL_AGGREGATE_TYPES.has(this.aggregateType)` permits trusted absent reads |
| metadata, spans, metrics, two ops explorers | a single label |

## Decision

**A pipeline declares a set of aggregates. One is the common case, not the
rule.**

```ts
definePipeline({
  name: "authz",
  aggregates: [grantAggregate, roleAggregate],
})
```

`aggregate:` (singular) remains valid and means a set of one. The 17 existing
pipelines do not change.

**An event's aggregate is the catalogue's answer, and the pipeline must own
it.** Append validation stops comparing the event's stamped type against the
pipeline's declared type and instead checks two things: the catalogue maps
`event.type` to an aggregate the pipeline declares, and `event.aggregateType`
equals that aggregate. This is strictly stronger than today's check. Today an
event carrying a grant event type under a correctly stamped `authz_grant` is
accepted even if the catalogue says that event type is a role's; tomorrow it
is rejected.

```
                  catalogue.aggregateFor(event.type)
                              │
                              ▼
   pipeline.aggregates ∋ A   and   event.aggregateType == A
         (ownership)                    (stamp agrees)
```

**A command binds to one aggregate, explicitly.** The command queue group key
is computed from the payload before any handler runs, so the aggregate cannot
be inferred from the events a handler will emit. Registration names it:

```ts
.withCommand(DefineRoleCommand, { aggregate: roleAggregate })
```

On a single-aggregate pipeline the option is optional and defaults to the one
aggregate, so every existing registration is unchanged and every existing
command queue key is byte-identical. On a multi-aggregate pipeline the builder
rejects a command that names no aggregate, and rejects one naming an aggregate
the pipeline does not declare. The command's bound aggregate replaces the
pipeline's type in the queue key and in the dispatcher parameters.

**Re-fold loaders take the type from the event they are re-folding.** The
auto-wired `eventLoaderUpTo` and `eventLoaderUpToPaged` already receive
`upToEvent`, which carries its own `aggregateType`; the `occurredAt` re-fold
loader gains `aggregateType` in its context, supplied by the executor from the
delivered event. No loader closes over a pipeline-level type.

**Fold state stays keyed by `aggregateId`, and the builder proves it is
enough.** `RepositoryFoldStore` keys rows by `aggregateId` alone. Two
aggregates sharing a pipeline — and therefore sharing its fold projections —
need ids that can never collide. We hold this with a declaration rather than
a storage change: `defineAggregate` accepts an `idPrefix`, the builder rejects
a pipeline whose aggregates share a prefix, and the command dispatcher rejects
a command whose `getAggregateId` returns an id outside its bound aggregate's
prefix. A single-aggregate pipeline may omit the prefix; a multi-aggregate
pipeline may not. This is the one new invariant the change introduces, and it
is the one place where the change could be wrong silently, so it is the one
place that is checked on every write rather than at registration.

**The time-local gate becomes a conjunction.** A fold may trust an absent
windowed read only when every aggregate the pipeline declares is time-local.
A pipeline mixing a time-local and a long-lived aggregate loses the
optimisation for both, which is correct: the absent read proves nothing for
the long-lived one.

**Ops scope stays per pipeline and projection.** Pause keys, replay selection
and retention are unchanged. An operator pausing the `authz` ledger fold
pauses it for grants and roles alike, which is what "one projection" means.
Metadata and the ops explorers list the pipeline's aggregate types instead of
naming one; the explorer that resolves a pipeline from an aggregate type
resolves from any of them.

## Rationale / Trade-offs

The alternative the split invited is one pipeline per aggregate. It is what
the framework's shape suggests and it needs no framework change. It was
rejected because a pipeline is not only an aggregate's home: it is a command
queue, a projection set, a pause key and a replay scope, and grants and roles
want all four in common. Two pipelines for one feature would duplicate the
ledger fold, the audit map and the permission-cache invalidation, and give an
operator two surfaces for one migration. #7406 collapsing both families onto
one type is the mirror image: it keeps the operational unit and gives up the
aggregate identity that ADR-110 exists to state. Neither is what the domain
says, and the framework was the only thing in the way.

Inferring a command's aggregate from its handler's declared event types was
considered for the command binding. It avoids a new option on registration
but puts a second declaration on every handler and makes the queue key depend
on a lookup through the catalogue at dispatch time. An explicit `aggregate`
on the registration is one word, is checked once at build, and defaults away
on every pipeline that exists today.

Keying fold state by `aggregateType + aggregateId` was considered and is the
theoretically clean answer. It touches every fold table, every fold
repository and every existing row. A prefix assertion costs two checks and no
migration, and ids in this codebase already carry their kind. The trade is
that the invariant lives in a declaration rather than in the schema; the
per-write check is what keeps that honest.

Scoping pause, replay and retention by aggregate type was considered and
rejected. The projections that would need it are, by construction, the ones
that fold both families; a type segment in the pause key would let an
operator pause half of one projection's input, which is a new failure mode
rather than a finer control.

What this does not buy: nothing about a pipeline's concurrency changes. The
lane is still the aggregate (ADR-100), so a grant and a role on the same
pipeline fold concurrently exactly as two grants do.

## Consequences

- `authz_grant` and `authz_role` become two declared aggregates on one
  pipeline, with the stamps ADR-110 specified. The comment #7406 added to
  `constants.ts` is replaced, and the constants it deleted return.
- Append validation gets stronger for every pipeline, including the 16 that
  declare one aggregate: an event type filed under the wrong aggregate is now
  rejected at the store, not just a mismatched stamp.
- `defineAggregate` gains an optional `idPrefix`; it is mandatory only when
  an aggregate shares a pipeline.
- Command registration gains an optional `aggregate`; it is mandatory only on
  a multi-aggregate pipeline.
- `PipelineMetadata.aggregateType` becomes `aggregateTypes`. The two ops
  explorers and the introspection functions in `pipelineRegistry.ts` follow.
  `RegisteredPipeline.aggregateType` is kept as the first declared type for
  the duration of the migration and removed once nothing reads it.
- The `occurredAt` re-fold loader's context gains `aggregateType`. Custom
  `eventLoader` implementations that ignore the field keep working on a
  single-aggregate pipeline and are wrong on a multi-aggregate one; the
  builder warns when a multi-aggregate pipeline registers a fold with a
  custom loader.
- No queue key, fold row, replay marker or event row changes shape. The
  change is deployable without a migration.

## Deployment Impact

None on deploy. No storage shape, queue key or pause key changes. The
authorization pipeline's two aggregate types start being stamped only once
the ADR-110 migration runs, which still requires an operator to enrol an
organization.

## References

- ADR-110: a grant is an aggregate; finishing the migration is the switch
- ADR-100: the aggregate-scoped lane
- PR #7406: fix(authz): a role event carries the aggregate type of the
  pipeline it rides
- `packages/eventing/src/stores/eventStoreUtils.ts` — `eventToRecord`, the
  row that carries `event.aggregateType`
- `packages/eventing/src/domain/definitions.ts` — `EventCatalogue`, one
  aggregate per event type
