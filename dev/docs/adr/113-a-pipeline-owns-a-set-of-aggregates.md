# ADR-113: A pipeline owns a set of aggregates

**Date:** 2026-08-22

**Status:** Proposed

**Builds on:** [ADR-110](110-grant-aggregates-are-grants.md) (a grant is an
aggregate, and so is a role), [ADR-066](066-projection-clickhouse-cached-store.md)
(the trusted-absence window, whose time-local rule this ADR restates for a
set), [ADR-092](092-unified-authorization-engine.md) §13 (the authorization
id doctrine).

**Related:** the behavioural contract
[multi-aggregate-pipeline.feature](../../../specs/event-sourcing/multi-aggregate-pipeline.feature);
[authz-grants.feature](../../../specs/rbac/authz-grants.feature), whose
"a role's aggregate is the role" scenario this decision lets the code satisfy;
[internal-feature-flags.feature](../../../specs/ops/internal-feature-flags.feature),
which pins the kill-switch key shape this ADR extends; PR #7406, the fix this
decision makes unnecessary.

**Target:** the engine at `platform/app/src/server/event-sourcing/`, as on
`main`. The in-flight `packages/eventing` extraction (#6051) carries the same
structure under different names (`definePipeline({ aggregate })` for
`.withAggregateType()`, an `EventCatalogue` for the per-projection event
lists); the decision applies to it unchanged, and the section "Under the
extraction" says what maps to what.

## Context

A pipeline declares exactly one aggregate type:

```ts
createStaticPipelineBuilder("authz_grant")
  .withAggregateType("authz_grant")
  .withCommand(AttachGrantCommand)
  .withCommand(DefineRoleCommand)
```

ADR-110 split the authorization ledger into two aggregates — `authz_grant`
and `authz_role` — with distinct lifecycles, distinct ids and distinct event
vocabularies, and then had to put both on the one `authz_grant` pipeline,
because a pipeline is also the unit that owns a command queue, a set of
projections, a pause key, a kill-switch key and a replay scope. Splitting the
pipeline to match the aggregates would have meant two queues, two copies of
the ledger fold and two places for an operator to look at one feature.

The result was the bug #7406 fixes: role commands stamped `authz_role`, the
pipeline declared `authz_grant`, and the store rejected every role event at
index 0 of the first migration batch. #7406 makes the role commands stamp the
pipeline's type — which contradicts the bound scenario
`authz-grants.feature` "A role's aggregate is the role" (`Then the appended
event's aggregate type is "authz_role"`) — and its constants file now reads
"ONE aggregate TYPE for both families, and it is not cosmetic. The type is
the storage partition key."

That sentence is the reason for this ADR, because it is not what the code
does. The declared type is threaded from the pipeline through
`EventSourcingService.storeEvents` into `AbstractEventStore.storeEvents`, and
on that path it is used for exactly two equality checks. The row that reaches
ClickHouse is built by `eventToRecord`, which writes `event.aggregateType` —
the value the command stamped, not the value the pipeline declared.

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

(`domain/aggregateType.ts` says events are "partitioned by tenantId +
aggregateType"; the schema partitions `event_log` by week and *sorts* by
`(TenantId, AggregateType, AggregateId, IdempotencyKey)`. Either way the
value in the row is the event's own.)

Everything downstream of the row is per event as well. Fold and map queue
groups are keyed `${event.aggregateType}:${event.aggregateId}`. Replay
discovers aggregates by event type and carries each one's own type out of the
log. Replay markers, fold-drain group ids and the process-manager inbox key
are all built from the event in hand.

So the single-aggregate rule is a convention that the framework asserts, not
a property the storage layer relies on. The comment #7406 corrected — "the
declared type is a label, nothing routes on it" — was closer to the truth than
the code that replaced it.

Five places do use the pipeline's declared type as a value rather than as an
assertion, and they are the whole cost of the change:

| Site | What it does with the type |
|---|---|
| `EventSourcingService` fold/map event loaders | closes over it (`capturedAggregateType`) to call `getEvents` / `getEventsUpTo` / `getEventsUpToPaged` for a re-fold |
| `QueueManager` command registration | `${tenantId}:${aggregateType}:${aggregateId}` is the command queue group key and the dedup key |
| `utils/killSwitch.ts` | `es-<aggregateType>-<component>-<name>-killswitch` for every command, fold, map and subscriber; checked in `commandDispatcher` and six sites in `projectionRouter` |
| `ProjectionRouter` time-local gate | `TIME_LOCAL_AGGREGATE_TYPES.has(this.aggregateType)` permits a fold to trust an absent windowed read |
| `PipelineMetadata`, spans, metrics, `ops/event-explorer.service.ts`, `ops/manager-explorer.service.ts` | a single label; the explorers resolve a pipeline *from* a type |

One more fact shapes the decision. Fold state is keyed by `aggregateId`
alone: `RepositoryFoldStore` writes `id: context.aggregateId` and reads
`getProjection(aggregateId, { tenantId })`. Two aggregates sharing a pipeline
share its fold projections, so their ids would share a key space. They are
**not** disjoint by construction: a migrated grant keeps "the legacy row's own
id" (`authz-grants.feature`, `authz-engine.migration.ts`), and `RoleBinding`,
`CustomRole` and `ShareLink` ids are unprefixed `nanoid()`s; a live binding is
minted as `rolebinding_…`; only `deriveGrantId` yields `grant_…`, and outside
production every KSUID carries an environment prefix on top. ADR-110's "all
three produce a `grant_`-prefixed KSUID" is not true of the ids the migration
actually states. An invariant that depends on id prefixes would reject the
very facts the feature exists to store.

## Decision

**A pipeline declares a set of aggregate types, each with the event types it
owns. One is the common case, not the rule.**

```ts
createStaticPipelineBuilder("authz_grant")
  .withAggregateTypes({
    authz_grant: AUTHZ_GRANT_EVENT_TYPES,
    authz_role: AUTHZ_ROLE_EVENT_TYPES,
  })
```

`.withAggregateType("x")` remains valid and means the set `{ x }` with no
ownership list — today's contract, today's validation. The 17 existing
pipelines do not change.

**On a multi-aggregate pipeline, an event's aggregate is the one that owns
its event type, and the stamp must agree.** Append validation on such a
pipeline checks that `event.type` is owned by one of the declared aggregates
and that `event.aggregateType` is that aggregate. An event type may be owned
by at most one aggregate on a pipeline; the builder rejects a duplicate. A
single-aggregate pipeline keeps the existing equality check and is not
touched.

```
                  owner(event.type) within pipeline
                              │
                              ▼
   pipeline.aggregates ∋ A   and   event.aggregateType == A
         (ownership)                    (stamp agrees)
```

**A command binds to one aggregate, explicitly.** The command queue group
key and the dedup key are computed from the payload before any handler runs,
so the aggregate cannot be inferred from the events a handler will emit.
Registration names it:

```ts
.withCommand(DefineRoleCommand, { aggregateType: "authz_role" })
```

On a single-aggregate pipeline the option is optional and defaults to the one
type, so every existing registration is unchanged and every existing command
queue key, dedup key and kill-switch key is byte-identical. On a
multi-aggregate pipeline the builder rejects a command that names no
aggregate, and one naming an aggregate the pipeline does not declare. The
bound type replaces the pipeline's type in the queue key, the dedup key and
the command's kill-switch key (`es-authz_role-command-defineRole-killswitch`).

**Re-fold loaders take the type from the event they are re-folding.** The
auto-wired `eventLoaderUpTo` and `eventLoaderUpToPaged` already receive
`upToEvent`, which carries its own `aggregateType`; the `occurredAt` re-fold
loader's context gains `aggregateType`, supplied by the executor from the
delivered event. No loader closes over a pipeline-level type.

**Fold state on a multi-aggregate pipeline is keyed by
`${aggregateType}:${aggregateId}`.** `ProjectionStoreContext` already has a
`key` that "defaults to `aggregateId` when not set"; on a multi-aggregate
pipeline the router sets it to the qualified form for every fold, state and
map store call, and the same qualified key is what replay and the fold drain
already use for their group ids. No column, table or existing row changes:
the value in the existing key column gains a prefix, and only on pipelines
that do not exist yet. A single-aggregate pipeline keeps the bare id. The
price is on the read side — application code that reads a fold row by id must
qualify it — and it is named under Consequences.

**Kill-switch keys for projections and subscribers on a multi-aggregate
pipeline use the pipeline name in the aggregate segment.** A fold that folds
both families has no one type; `es-<pipelineName>-projection-<name>-killswitch`
is the key, and `internal-feature-flags.feature` records the rule. Commands
use their bound type, above. Nothing renames: no multi-aggregate pipeline
exists today, and the authorization pipeline keeps its name `authz_grant`, so
its projection keys are exactly the keys it has now.

**The time-local gate becomes a conjunction.** A fold may trust an absent
windowed read only when every aggregate the pipeline declares is in
`TIME_LOCAL_AGGREGATE_TYPES`. `fold-read-window.feature` already states the
rule in the plural ("unless the fold's aggregates are time-local"); this makes
the code match it.

**Ops scope stays per pipeline and projection.** Pause keys
(`<pipeline>/projection/<name>`), replay selection and retention are
unchanged. An operator pausing the ledger fold pauses it for grants and roles
alike, which is what "one projection" means. `PipelineMetadata.aggregateType`
becomes `aggregateTypes`; the two explorers list them and resolve a pipeline
from any of them.

### Under the extraction

When the `packages/eventing` extraction lands, `withAggregateTypes` is
`definePipeline({ aggregates: [grantAggregate, roleAggregate] })` with the
ownership lists coming from each `defineAggregate`'s `events`, and the
per-pipeline ownership check is the `EventCatalogue` lookup. Nothing else in
this decision depends on which surface is current.

## Rationale / Trade-offs

The alternative the split invited is one pipeline per aggregate. It is what
the framework's shape suggests and it needs no framework change. It was
rejected because a pipeline is not only an aggregate's home: it is a command
queue, a projection set, a pause key and a replay scope, and grants and roles
want all four in common. Two pipelines for one feature would duplicate the
ledger fold, the audit map and the permission-cache invalidation, and give an
operator two surfaces for one migration. #7406 collapsing both families onto
one type is the mirror image: it keeps the operational unit and gives up the
aggregate identity that ADR-110 exists to state, and it leaves a bound
scenario in `authz-grants.feature` asserting a stamp the code no longer
produces. Neither is what the domain says, and the framework was the only
thing in the way.

Inferring a command's aggregate from its handler's declared event types was
considered. It avoids a new option on registration but puts a second
declaration on every handler and makes the queue key depend on a lookup at
dispatch time. An explicit `aggregateType` on the registration is one word,
is checked once at build, and defaults away on every pipeline that exists.

Asserting that the two aggregates' ids carry distinct prefixes — and keeping
the bare-id fold key — was the first draft of this ADR and was rejected on
the evidence in Context: the ids are not prefixed, and a per-write prefix
check would refuse every migrated fact. Adding the type to the fold key is
the correct-by-construction answer, and the existing `key` override makes it
a value change rather than a schema change.

Scoping pause, replay and retention by aggregate type was considered and
rejected. The projections that would need it are, by construction, the ones
that fold both families; a type segment in the pause key would let an
operator pause half of one projection's input, which is a new failure mode
rather than a finer control. Kill-switch keys get a pipeline-name segment for
the same reason.

Making the ownership check apply to single-aggregate pipelines too was
considered; it would reject an event type filed under the wrong aggregate on
all 17 pipelines. Those pipelines declare no ownership list today, so the
check would first require 17 declarations for no feature. It is available to
any pipeline that opts into `withAggregateTypes` with one entry.

What this does not buy: nothing about a pipeline's concurrency changes. The
lane is still the aggregate, so a grant and a role on the same pipeline fold
concurrently exactly as two grants do.

## Consequences

- `authz_grant` and `authz_role` become two declared aggregate types on the
  `authz_grant` pipeline, stamped as ADR-110 and `authz-grants.feature`
  specify. The comment #7406 added to `constants.ts` is replaced and the
  `AUTHZ_ROLE_AGGREGATE_TYPE` constant it deleted returns; its
  `aggregateIdentity` test asserts against the pipeline's declared **set**.
- The ledger fold's rows for the authorization pipeline are keyed
  `authz_grant:<grantId>` / `authz_role:<roleId>`. The ledger read path
  (`grantsLedger`, the permission projection loader) qualifies the id. No
  rows exist to migrate: the store refused every write until now.
- `withCommand` gains an optional `aggregateType`; mandatory only on a
  multi-aggregate pipeline.
- The `occurredAt` re-fold loader's context gains `aggregateType`. A custom
  `eventLoader` that ignores it keeps working on a single-aggregate pipeline
  and is wrong on a multi-aggregate one; the builder refuses a
  multi-aggregate pipeline that registers a fold with a custom loader unless
  the loader declares itself type-aware.
- `PipelineMetadata.aggregateType` → `aggregateTypes`; `RegisteredPipeline.
  aggregateType` is kept as the first declared type until nothing reads it.
- Kill-switch keys gain one rule (pipeline name for projections on a
  multi-aggregate pipeline) and rename nothing.
- No event row, queue key, pause key or existing fold row changes. The
  change is deployable without a migration.

## Deployment Impact

None on deploy. No storage shape, queue key, pause key or kill-switch key
changes for any existing pipeline. The authorization pipeline's two aggregate
types start being stamped only once the ADR-110 migration runs, which still
requires an operator to enrol an organization.

## References

- ADR-110: a grant is an aggregate; finishing the migration is the switch
- ADR-066: the fold's trusted-absence window
- ADR-092 §13: authorization ids
- PR #7406: fix(authz): a role event carries the aggregate type of the
  pipeline it rides
- `platform/app/src/server/event-sourcing/stores/eventStoreUtils.ts` —
  `eventToRecord`, the row that carries `event.aggregateType`
- `platform/app/src/server/event-sourcing/projections/projectionStoreContext.ts`
  — `key`, the fold-state key override
- `platform/app/src/server/event-sourcing/utils/killSwitch.ts` — the key
  shape
