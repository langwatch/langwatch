# Eventing is a contract-sealed framework with substrate-aware inline pipelines

**Date:** 2026-08-20

**Status:** Accepted

**Behavioural contracts:**
[the framework boundary](../specs/eventing-framework.feature) and
[post-event work](../specs/post-event-work.feature)

**Related:**
[the Group Queue framework boundary](../../group-queue/adrs/20260820-group-queue-framework-boundary.md),
[projection replay coordination](./015-projection-replay-coordination.md),
[ClickHouse cached projections](./066-clickhouse-cached-projections.md),
[events and staged payloads](./089-events-and-staged-payloads.md), and
[the modular package architecture](../../../dev/docs/adr/070-modular-package-architecture.md).

## Context

Eventing has two distinct layers:

1. a reusable framework for events, commands, ordered dispatch, projections,
   subscribers, process managers and replay; and
2. the LangWatch composition root: product pipelines, enterprise wiring,
   Prisma stores, concrete ClickHouse policy, global billing projections,
   replay presets and the catalogue of every application event.

The package boundary separates these layers. The reusable framework stays
small, explicit and difficult to misuse, while product composition remains in
the application until its owning feature has its own package.

## Decision

### 1. Package boundary and dependency direction

`@langwatch/eventing` owns:

- event, command and aggregate definitions;
- the pipeline builder and immutable pipeline metadata;
- dispatch orchestration and framework lifecycle;
- substrate-aware projection contracts and executors;
- event subscribers and projection subscribers;
- process-manager contracts, state transitions, inbox/outbox semantics and
  scheduling ports;
- replay contracts and the generic replay engine;
- framework errors, observability ports and testing helpers.

It depends on `@langwatch/group-queue` for ordered background transport.
Neither framework imports the platform app, product features or enterprise
code.

The package may define generic repository and cache ports for ClickHouse,
Postgres and Redis semantics. Concrete repositories tied to application
tables, Prisma models, retention rules or app configuration stay outside.
Prisma-generated types and values are forbidden in the package and in its
public contracts.

### 2. The app is the composition root

The application layout is:

```text
platform/app/src/server/event-sourcing/
  pipelines/       # product pipeline factories and their handlers
  registration/    # PipelineRegistry and the application event catalogue
  adapters/        # Prisma, ClickHouse, Redis and observability adapters
  replay/          # application replay preset and product selection policy
```

Product pipelines, global billing projections, `PipelineRegistry`, the
application replay preset, the Prisma process store and the complete
core-plus-enterprise event catalogue live here or with the feature that owns
them. Their composition does not change the framework.

### 3. Aggregates and events are declared once

An aggregate owns its stable type and allowed event definitions:

```ts
const spanReceived = defineEvent("span_received");

const trace = defineAggregate({
  type: "trace",
  events: [spanReceived, traceCompleted],
});
```

Pipelines refer to these definition objects rather than repeating aggregate
types. `aggregateType` is a persisted domain concept and is declared once on
the aggregate passed to `definePipeline`.

There is no hidden global mutable registry in the framework. The application
composition root builds an explicit event catalogue from the pipeline
definitions it installs. Catalogue construction rejects duplicate event
ownership and gives core and enterprise composition the same typed seam.

`createdAt` is the canonical storage timestamp. `occurredAt` separately records
when the business action happened; there is no generic `timestamp` alias.

### 4. Projections are inline and substrate-aware

A projection definition carries its own name and joins the pipeline through a
substrate-specific method, so registration never repeats that name:

```ts
const traceProcessing = definePipeline({
  name: "trace_processing",
  aggregate: trace,
})
  .withCommand("recordSpan", RecordSpanCommand)
  .withClickHouseMapProjection(new SpanStorageMapProjection({ store: deps.spanStorage }))
  .withClickHouseFoldProjection(new TraceSummaryFoldProjection({ store: deps.traceSummary }))
  .withPostgresProjection(new GrantsStateProjection({ store: deps.grants }))
  .build();
```

The three methods encode different guarantees:

| Builder                        | Semantics                                                                      | Required infrastructure                                     |
| ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `withClickHouseMapProjection`  | transform one event into a document/row without reading prior projection state | ClickHouse append/replacing store                           |
| `withClickHouseFoldProjection` | load the latest state, evolve it purely, then write it back                    | ClickHouse store behind the app's Redis consistency adapter |
| `withPostgresProjection`       | load and evolve one row under the Postgres projection contract                 | Postgres repository; no ClickHouse cache options            |

ClickHouse folds require the app's Redis consistency adapter because replication
and deduplication lag cannot feed stale state into the next evolution. Map
projections do not read prior state; any query-side cache is an application
adapter concern.

Projection evolution is synchronous and pure. Repositories perform I/O and
return contract-owned documents, never Prisma records or raw driver results.
Projection definitions require their store, version and evolution operations;
the pipeline builder prevents a projection from being registered through an
ambiguous storage-agnostic method.

Projection source cannot perform network calls, use timers, await work, or
fabricate another durable event. Static architecture lint enforces those
observable boundaries. CPU cost cannot be proven statically, so
`es_projection_duration_milliseconds` remains the operational guard for
unbounded or unexpectedly heavy evolution.

### 5. Subscribers say which consistency boundary they observe

Subscriber authoring has two methods with distinct consistency boundaries:

- `withEventSubscriber` runs after an event is durably appended and receives
  the event plus event context. It has no projection state.
- `withProjectionSubscriber` is attached to a projection registered earlier
  in the same builder. It runs only after that projection commits and receives
  the exact committed document/state, whose type is inferred from the
  projection name.

```ts
.withEventSubscriber("auditEvent", {
  name: "auditEvent",
  eventTypes: [spanReceived.type],
  handle: deps.auditEvent,
})
.withProjectionSubscriber("evaluationTrigger", {
  fold: "traceSummary",
  events: [spanReceived.type, traceCompleted.type],
  when: deps.shouldEvaluate,
  handler: deps.triggerEvaluation,
})
```

Both are best-effort side effects: relevance is decided before enqueue, jobs
are at-least-once after staging, and subscribers do not run during replay.
Every externally visible action performed by either subscriber kind must be
idempotent for the source event. A handler derives or forwards a stable action
identity from the subscriber action and source event identity, so a crash
after the action but before queue acknowledgement cannot repeat the effect. A
database action may instead atomically deduplicate and apply the effect in one
transaction. Queue deduplication is an optimisation and does not satisfy this
rule by itself.

Each product subscriber has a redelivery test proving that handling the same
source event twice leaves one externally visible result. If its target cannot
support that contract, the action is not safe to run as a subscriber. Work
that cannot tolerate the pre-staging loss window is a process manager, whose
intent executor is still required to be retry-safe.

### 6. Process managers are inline, durable orchestration

`withProcessManager` is the stake-sensitive primitive and uses the same inline
builder shape:

```ts
.withProcessManager("triggerSettlement", (process) =>
  process
    .state(initialSettlement)
    .intent("charge", ChargeIntent, deps.charge)
    .on(triggerFired.type, evolveSettlement)
    .outbox({ maxAttempts: 8 }),
)
```

The name is declared once. Event selection, process identity and state
transitions are explicit and typed. The framework owns exactly-once inbox
consumption, durable process state, wake scheduling and outbox dispatch
semantics through ports. The app supplies the concrete process store,
transaction boundary and executor integrations.

Process handlers must be retry-safe. This decision does not introduce broad
cross-feature database transactions or make a process manager a substitute
for an application service.

Feature source separates pure process evolution from its intent executors:
`processes/<subject>.process.ts` derives state, wakes, and deterministic intent
keys; `intents/<subject>.intent.ts` performs retry-safe I/O. When an intent or
subscriber needs another durable domain event, it invokes the owning feature
command/pipeline. Projections, process evolution, and subscribers never
construct or append durable events directly.

### 7. The public API is sealed and linted

Each framework package has a deliberate root API and a small number of named
subpath exports. Consumers cannot import implementation files, repositories,
executors or generated database types by path.

CI enforces:

- Group Queue has no Eventing, app or enterprise imports;
- Eventing has no app, feature, enterprise or Prisma imports;
- the app imports framework symbols only from public package exports;
- no repository returns Prisma-generated types outside its adapter boundary;
- product pipelines depend on other features through contracts/services, not
  their repositories;
- projection and process evolution source contains no asynchronous, network,
  timer, dynamic-import, or direct event-append work;
- subscribers and intent executors create durable events only through owning
  commands/pipelines;
- every strict-package subscriber has a named redelivery test proving its
  externally visible effect is idempotent for the source event;
- event and projection registrations are unique;
- compile-time misuse examples continue to fail.

Package tests cover pure definitions and builder types. Adapter integration
tests cover Redis, ClickHouse and Postgres behavior. Framework behavior specs
live in this package; product-specific scenarios live with the product that
owns them.

### 8. Documentation is part of the package boundary

Each package owns:

```text
README.md          # entry points, short usage and support policy
adrs/              # lasting package design decisions
specs/             # package behavioral contracts
src/               # implementation and colocated tests
```

Framework documents live here with their parity bindings. Product documents
live with the owning feature or application. Every decision and behaviour has
one live source of truth.

Comments in source explain contracts, correctness invariants and surprising
failure behavior.

## Alternatives considered

Putting application composition and product policy in the framework package
was rejected because it would invert the dependency boundary.

Generic projection builders were not selected because their storage and
consistency requirements are invisible at the call site. Substrate-aware
methods are longer but make invalid combinations unrepresentable.

Repeating projection names in both definitions and registrations was rejected.
Definitions remain reusable, while substrate-specific registration derives the
name from the definition.

A framework-owned global event registry was rejected because import order and
enterprise availability would mutate global state. An explicit application
catalogue makes installed capabilities visible and validates them once.

Treating every side effect as a process manager was rejected because the
durable inbox/outbox cost is wrong for high-volume, lossy-by-contract work.
Keeping one ambiguous subscriber method was also rejected because state
availability would remain a runtime convention.

## Consequences

- Pipeline definitions read as a complete description of commands,
  projections and post-event work.
- Storage consistency requirements are checked when a projection is authored,
  rather than discovered in production.
- Application and enterprise pipelines can use the framework without being
  dependencies of it.
- Type-safe event references and projection-state inference avoid repeated
  strings in most authoring positions.
- Builders and adapters require more explicit dependencies, especially Redis
  consistency caches for ClickHouse fold projections.
- Product behavior and storage schemas remain independent of the framework
  boundary.
