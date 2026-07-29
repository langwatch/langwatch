# Event Sourcing - Implementation Guide

For conceptual overview and architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Creating a Pipeline

A pipeline is a factory function. It takes store interfaces, ports and pre-built artifacts, constructs everything it registers from imported factories, and returns a static definition built by `definePipeline()`. The whole topology is readable in `pipeline.ts` without opening the composition root (ADR-082 Rule 1).

### Step 1: Define the Pipeline (static, no runtime deps)

```typescript
import { definePipeline } from "~/server/event-sourcing";
import type { CommandBus } from "~/server/event-sourcing/commands/commandBus";

export interface MyPipelineDeps {
  summaryStore: FoldProjectionStore<SummaryState>;
  recordRepository: MyRecordRepository;
  broadcast: BroadcastService;
  /** ADR-082 §5 -- identity-keyed dispatch into other pipelines' commands. */
  commands: CommandBus;
}

export function createMyPipeline(deps: MyPipelineDeps) {
  return definePipeline<MyEvent>()
    .withName("my_processing")
    .withAggregateType("my_aggregate")
    .withFoldProjection(
      "summary",
      new SummaryFoldProjection({ store: deps.summaryStore }),
    )
    .withMapProjection(
      "records",
      new RecordsMapProjection({
        store: new RecordsAppendStore(deps.recordRepository),
      }),
    )
    .withEventSubscriber(
      "notify",
      createNotifySubscriber({ broadcast: deps.broadcast }),
    )
    .withCommand("doSomething", DoSomethingCommand)
    .withProcessManager(
      "settlement",
      settlementPM({ finish: deps.commands.port(FinishCommand) }),
    )
    .build();
}
```

`pipelines/metric-processing/pipeline.ts` and `pipelines/simulation-processing/pipeline.ts` are the reference shapes.

### Step 2: Register at Runtime

```typescript
const registered = eventSourcing.register(createMyPipeline({ /* stores, ports */ }));

// `registered.commands.X` is the command's queue processor
await registered.commands.doSomething.send({ tenantId: "acme", /* payload */ });

// `mapCommands` flattens them to plain async functions for the app layer
const commands = mapCommands(registered.commands);
await commands.doSomething({ tenantId: "acme", /* payload */ });
```

Registration connects the static definition to ClickHouse, Redis, and the in-house [GroupQueue](./queues/groupQueue/README.md) (no BullMQ). This happens in the composition root (`pipelineRegistry.ts`).

## Builder API

| Method | Description |
|--------|-------------|
| `.withName(name)` | Pipeline name (must be unique) |
| `.withAggregateType(type)` | Aggregate type for event grouping |
| `.withFoldProjection(name, definition, options?)` | Accumulated state per aggregate (stateful, ordered) |
| `.withMapProjection(name, definition, options?)` | Per-event rows (stateless, parallel) |
| `.withProjection(name, definition)` | Operational state projection -- one direct load/apply/store under the queue's per-key lock |
| `.withEventSubscriber(name, definition)` | Live event consumer that receives no projection state |
| `.withProcessManager(name, applier)` | Durable state, deadlines, a leased outbox |
| `.withCommand(name, HandlerClass, options?)` | Command handler class (zero-arg constructor) |
| `.withCommandInstance(name, HandlerClass, instance, options?)` | Pre-constructed handler, for constructor DI |
| `.withFeatureFlagService(service)` | Optional kill-switch support |
| `.build()` | Build the static pipeline definition |

Names are unique across all projection kinds -- the builder throws on a collision.

## Defining Projections

### Fold Projection

A fold projection reduces events into accumulated state, one aggregate at a time:

```typescript
import type { FoldProjectionDefinition } from "~/server/event-sourcing";

const summaryFoldProjection: FoldProjectionDefinition<SummaryState, MyEvent> = {
  name: "summary",
  version: "2026-07-28",          // schema version of the stored state
  eventTypes: ["lw.my.created", "lw.my.updated"],
  LastEventOccurredAtKey: "LastEventOccurredAt",
  init: () => ({ count: 0, LastEventOccurredAt: 0 }),
  apply: (state, event) => ({
    ...state,
    count: state.count + 1,
    LastEventOccurredAt: event.occurredAt,
  }),
  store: myFoldStore,
};
```

Most pipelines subclass `AbstractFoldProjection` ([`projections/abstractFoldProjection.ts`](./projections/abstractFoldProjection.ts)) instead, which derives a `handleXxx` method per event type from Zod schemas and supplies `apply` for you.

The `store` must implement `FoldProjectionStore<State>`:

```typescript
interface FoldProjectionStore<T> {
  readonly projectionVersion?: string;
  get(aggregateId: string, context: ProjectionStoreContext): Promise<T | null>;
  store(state: T, context: ProjectionStoreContext): Promise<void>;
}
```

A store that reads committed rows back **must gate on `projectionVersion`** and report an older stamp as a miss (ADR-066) -- otherwise a row written before a column existed decodes its default into permanently wrong state.

### Map Projection

A map projection transforms individual events into records:

```typescript
import type { MapProjectionDefinition } from "~/server/event-sourcing";

const recordsMapProjection: MapProjectionDefinition<RecordType, MyEvent> = {
  name: "records",
  eventTypes: ["lw.my.created"],
  map: (event) => ({ id: event.id, data: event.data, at: event.occurredAt }),
  store: myAppendStore,
};
```

`AbstractMapProjection` is the class form, and the one the pipelines use.

The `store` must implement `AppendStore<Record>`:

```typescript
interface AppendStore<T> {
  append(record: T, context: ProjectionStoreContext): Promise<void>;
  bulkAppend?(records: T[], context: BulkAppendContext): Promise<void>;
}
```

### State Projection

`.withProjection()` registers the default operational projection -- mechanically a fold, but with a deliberately narrower contract: direct store `load`/`apply`/`store`, no event-log recovery read, no Redis cache hook, no attached outbox. The adopters are Langy's conversation and turn state, topic clustering's run status / history / model, and the enterprise ingestion-pull run status -- all Postgres.

```typescript
import type { StateProjectionDefinition } from "~/server/event-sourcing";

const conversationState: StateProjectionDefinition<ConversationData, MyEvent> = {
  name: "conversationState",
  version: "2026-07-28",
  eventTypes: ["lw.my.created"],
  init: () => ({ status: "open" }),
  apply: (state, event) => ({ ...state, status: "closed" }),
  store: conversationStateStore,   // { load, store }
};
```

The store persists a `StoredProjection<State>` -- the state plus its event cursor (`acceptedAt` + `eventId`), so a replay is deterministic.

### Event Subscriber

A subscriber is a live consumer of an event already committed to the log. It sees the event and nothing else (`EventSubscriberContext` is `tenantId` + `aggregateId`), is dispatched from the routing seam independent of any projection, and is never invoked by replay. It must make its own handling idempotent.

```typescript
import type { EventSubscriberDefinition } from "~/server/event-sourcing";

export function createNotifySubscriber(deps: {
  broadcast: BroadcastService;
}): EventSubscriberDefinition<MyEvent> {
  return {
    name: "notify",
    eventTypes: ["lw.my.updated"],   // empty means all event types
    handle: async (event, { tenantId, aggregateId }) => {
      await deps.broadcast.send(tenantId, { type: "updated", aggregateId });
    },
    options: { delay: 500, deduplication: "aggregate" },
  };
}
```

Delivery is **at-most-once unless the handler raises**: the routing path does not retry a fan-out, so a handler that swallows its error has silently dropped the work. Rethrow when redelivery is the right answer (`cancellationBroadcast` does); swallow only when a lost push is invisible by the next refetch.

`options.enqueue` carries the ADR-069 hooks -- `filter` decides whether a job is staged at all, `stage` swaps the payload for a claim-check reference. **Both must be total.** A throw there loses this subscriber's job for this event permanently.

### Process Manager

A process manager is the durable substrate: a transactional inbox, persisted state, `nextWakeAt` deadlines, and a leased outbox that retries up to its own `maxAttempts`. Author it with the staged callback builder and mount it by name:

```typescript
export function settlementPM(deps: {
  finish: (payload: FinishPayload) => Promise<void>;
}): ProcessManagerApplier<MyEvent> {
  return (pm) =>
    pm
      .state(INITIAL_STATE)
      .intent(INTENT_TYPES.FINISH, finishIntentSchema, createFinishHandler(deps))
      .on(MY_EVENT_TYPES.STARTED, handleStarted)
      .on(MY_EVENT_TYPES.SETTLED, handleSettled)
      .onWake(settlementWake)
      .toPayload(buildProcessEventView)
      .outbox({ maxAttempts: 5, leaseDurationMs: 300_000, concurrency: 4 });
}
```

The runtime owns the manager, the shared process outbox and the wake workers ([`process-manager/`](./process-manager/)). See ADR-052 and ADR-073.

### Choosing a substrate

ADR-075 decides it with one question -- *if this work is lost, does anything need to be able to tell?*

| If the work... | Substrate |
|---|---|
| pushes to whoever is connected right now | **event subscriber** -- a lost push is invisible by the next refetch |
| calls a third party where loss is acceptable by contract | **event subscriber**, debounced |
| produces state someone later reads as fact | **projection** -- replay rebuilds it |
| dispatches work that costs money or must happen | **process manager** -- leased outbox |
| happens *later* rather than *now* | **process manager** -- a durable deadline |

## Defining Commands

Commands validate intent and produce events:

```typescript
import { z } from "zod";
import { defineCommandSchema, type Command, type CommandHandler } from "~/server/event-sourcing";

const payloadSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
});

class RecordSpanCommand
  implements CommandHandler<Command<z.infer<typeof payloadSchema>>, MyEvent>
{
  static readonly schema = defineCommandSchema(
    "lw.obs.span_ingestion.record",
    payloadSchema,
  );

  static getAggregateId(payload: z.infer<typeof payloadSchema>): string {
    return payload.traceId;
  }

  async handle(command: Command<z.infer<typeof payloadSchema>>): Promise<MyEvent[]> {
    return [EventUtils.createEvent(/* ... */)];
  }
}
```

For a command that is a pure schema-to-event mapping, `defineCommand()` ([`commands/defineCommand.ts`](./commands/defineCommand.ts)) generates the whole class from a Zod event-data schema.

Derive the aggregate id and the `idempotencyKey` from the work's natural key, never mint one per attempt (ADR-081) -- deriving the id *is* the idempotency, and two retries of one unit of work must collapse in the event log.

### Cross-pipeline dispatch

A pipeline that dispatches into another pipeline's command takes the `CommandBus` and binds a port by class identity. Binding is eager, resolution happens at send time, so registration order carries no meaning:

```typescript
.withEventSubscriber(
  "codingAgentMetricFactsDispatch",
  createCodingAgentMetricFactsDispatchSubscriber({
    contributeMetricFacts: deps.commands.port(ContributeMetricFactsCommand),
  }),
)
```

`commandBus.assertPortsResolvable()` runs once registration completes, so a port bound to a command no pipeline registers fails at boot rather than on the first production dispatch (ADR-082 §5).

## Composition Root

The `PipelineRegistry` (in `pipelineRegistry.ts`) creates store adapters and the handful of artifacts a pipeline cannot build for itself, then registers every pipeline with the runtime. Pipelines receive store interfaces, ports and pre-built artifacts -- never raw deps like `prisma` or a ClickHouse client.

```typescript
export class PipelineRegistry {
  registerAll() {
    const evalPipeline = this.registerEvaluationPipeline({ automations });
    const codingAgentPipeline = this.registerCodingAgentPipeline();
    const { pipeline: tracePipeline } = this.registerTracePipeline({ evalPipeline, ... });
    // ... the rest, plus the enterprise set
    this.deps.eventSourcing.commandBus.assertPortsResolvable();

    return {
      traces: mapCommands(tracePipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      codingAgents: mapCommands(codingAgentPipeline.commands),
      // ...
    };
  }
}
```

## Testing

### Unit Tests

Use in-memory stores and `EventSourcing.createForTesting()`:

```typescript
import { EventSourcing } from "~/server/event-sourcing";
import { EventStoreMemory } from "~/server/event-sourcing/stores/eventStoreMemory";
import { EventRepositoryMemory } from "~/server/event-sourcing/stores/repositories/eventRepositoryMemory";

const eventStore = new EventStoreMemory(new EventRepositoryMemory());
const es = EventSourcing.createForTesting({ eventStore });

const registered = es.register(myPipeline);
```

### Integration Tests

Use `EventSourcing.createWithStores()` for integration tests with explicit stores:

```typescript
const es = EventSourcing.createWithStores({
  eventStore: new EventStoreMemory(new EventRepositoryMemory()),
});
```

### Running Tests

```bash
# All event-sourcing unit tests
pnpm test:unit src/server/event-sourcing

# Specific pipeline tests
pnpm test:unit src/server/event-sourcing/pipelines/trace-processing

# Integration tests (requires Docker services)
pnpm test:integration src/server/event-sourcing
```

## Navigating the Codebase

All paths below are relative to `src/server/event-sourcing/`.

### Core Infrastructure

| Directory | Description |
|-----------|-------------|
| `domain/` | Core types: `Event`, `Projection`, `TenantId`, `AggregateType` |
| `commands/` | Command handling: `Command`, `CommandHandlerClass`, `CommandSchema`, `CommandBus`, `defineCommand` |
| `pipeline/` | Static builder: `definePipeline()`, `StaticPipelineDefinition`, the process-manager builder |
| `services/` | `EventSourcingService` (main orchestration), `CommandDispatcher`, `QueueManager` |
| `projections/` | Executors and router: `FoldProjectionExecutor`, `MapProjectionExecutor`, `StateProjectionExecutor`, `ProjectionRouter`, `ProjectionRegistry`, `CachedFoldStore` |
| `subscribers/` | `EventSubscriberDefinition` and its options (ADR-069 enqueue hooks) |
| `process-manager/` | `ProcessRuntime`, the process service, the shared outbox and wake workers, process stores |
| `replay/` | Replay service: discovery, drain, and the fold / map / state rebuild paths |
| `queues/` | `GroupQueue` (in-house, Redis + Lua -- see [`queues/groupQueue/README.md`](./queues/groupQueue/README.md)) and `MemoryQueue` (in-process dev/test fallback) |
| `stores/` | Event store implementations: `EventStoreClickHouse`, `EventStoreMemory`, event repositories |
| `utils/` | `EventUtils` (event creation, validation), `KillSwitch` |
| `schemas/` | Shared type identifiers |

### Pipeline Implementations

Pipelines share an internal structure; a given pipeline has the subset it needs:

```
pipelines/<name>/
  commands/         # Command handlers (or a flat commands.ts)
  projections/      # Fold, map and state projection definitions + stores
  subscribers/      # Event subscriber factories
  process-manager/  # Process definitions, intent handlers, wake handlers
  repositories/     # Projection store implementations, where not injected
  schemas/          # Event types, command schemas, constants
  utils/            # Pipeline-specific utilities
  pipeline.ts       # Pipeline factory function (createXxxPipeline)
```

**Active pipelines (14):**

| Pipeline | Aggregate | Purpose |
|----------|-----------|---------|
| `trace-processing` | `trace` | Ingests OTLP spans, builds trace summaries and analytics |
| `metric-processing` | `metric` | Ingests canonical OTLP metric data points |
| `log-processing` | `log` | Ingests canonical OTLP log records |
| `evaluation-processing` | `evaluation` | Runs evaluations, tracks evaluation state |
| `experiment-run-processing` | `experiment_run` | Tracks experiment runs with evaluator results |
| `simulation-processing` | `simulation_run` | Tracks simulation run lifecycle, dispatches scenario execution |
| `coding-agent-processing` | `coding_agent_session` | Converges span / metric / log facts into a session aggregate |
| `langy-conversation-processing` | `langy_conversation` | Langy conversation, turn and message state |
| `topic-clustering-processing` | `topic_clustering` | Schedules and records topic clustering runs |
| `automations` | `trigger` | Trigger matching, settlement and webhook delivery |
| `billing-reporting` | `billing_report` | Monthly usage reporting |
| `blob-maintenance` | `global` | Sweeps orphaned GroupQueue blobs |
| `langy-maintenance` | `global` | Reaps expired Langy session API keys |
| `ingestion-pull-processing` (`@ee`) | `ingestion_pull` | Enterprise pull-based ingestion runs |

### Global Projections

Cross-pipeline projections live in `projections/global/` and are registered on a virtual `global` pipeline that receives events from every pipeline:

| Projection | Kind | Purpose |
|------------|------|---------|
| `orgBillableEventsMeter` | map | Records each billable event to ClickHouse for deduplicated per-organization counting |

### Entry Points

| File | Description |
|------|-------------|
| `index.ts` | Public exports for the module |
| `eventSourcing.ts` | `EventSourcing` central class (owns event store, queue factory, pipelines) |
| `pipelineRegistry.ts` | Composition root -- creates store adapters and registers all pipelines |
| `runtimePipeline.ts` | `EventSourcingPipeline` -- connects static definitions to runtime |
| `disabledPipeline.ts` | No-op pipeline returned when event sourcing is disabled |
| `mapCommands.ts` | Utility to convert command processors to typed dispatch functions |

## Common Pitfalls

1. **Missing tenant validation**: Always call `EventUtils.validateTenantId()` in store implementations.
2. **Read-back without a version gate**: A fold store that reads its own committed rows must compare `projectionVersion` and treat an older stamp as a miss. Without it, rows written before a column existed decode their defaults into state that never self-corrects.
3. **Fold store failures**: If `store.store()` fails, GroupQueue retries the entire event (with exponential backoff in front of the same group, preserving FIFO). Make sure your store is idempotent or uses upsert semantics.
4. **Map projection ordering**: Map projections have no ordering guarantees. Do not rely on event order in append stores.
5. **A subscriber that swallows its error**: Nothing re-dispatches subscriber fan-out. Catching and logging turns a retryable failure into permanent loss -- rethrow unless losing the work is genuinely invisible.
6. **Fallible `enqueue.filter` / `enqueue.stage`**: These run on the routing path, which has no retry. Restrict them to total predicates and field-picks.
7. **Process role mismatch**: Commands dispatched in a `web` process are enqueued but not processed until a role that runs workers picks them up. Gate on `roleRunsWorkers(role)`, never `processRole === "worker"`.
