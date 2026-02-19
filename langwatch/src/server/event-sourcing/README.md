# Event Sourcing - Implementation Guide

For conceptual overview and architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Creating a Pipeline

Pipelines are defined using the `definePipeline()` builder, then registered with the `EventSourcing` runtime at startup.

### Step 1: Define the Pipeline (static, no runtime deps)

```typescript
import { definePipeline } from "~/server/event-sourcing";

const pipeline = definePipeline<MyEvent>()
  .withName("my_pipeline")
  .withAggregateType("my_aggregate")
  .withFoldProjection("summary", summaryFoldProjection)
  .withMapProjection("records", recordsMapProjection)
  .withReactor("summary", "notify", notifyReactor)
  .withCommand("doSomething", DoSomethingCommand)
  .build();
```

### Step 2: Register at Runtime

```typescript
const registered = eventSourcing.register(pipeline);

// Send commands
await registered.commands.doSomething.add({ tenantId: "acme", /* payload */ });
```

Registration connects the static definition to ClickHouse, Redis, and BullMQ. This happens in the composition root (`pipelineRegistry.ts`).

## Builder API

| Method | Description |
|--------|-------------|
| `.withName(name)` | Pipeline name (must be unique) |
| `.withAggregateType(type)` | Aggregate type for event grouping |
| `.withFoldProjection(name, definition, options?)` | Register a fold projection (stateful, ordered) |
| `.withMapProjection(name, definition, options?)` | Register a map projection (stateless, parallel) |
| `.withReactor(foldName, reactorName, definition)` | Register a reactor on a fold projection |
| `.withCommand(name, HandlerClass, options?)` | Register a command handler |
| `.withFeatureFlagService(service)` | Optional kill-switch support |
| `.build()` | Build the static pipeline definition |

## Defining Projections

### Fold Projection

A fold projection reduces events into accumulated state:

```typescript
import type { FoldProjectionDefinition } from "~/server/event-sourcing";

const summaryFoldProjection: FoldProjectionDefinition<SummaryState, MyEvent> = {
  name: "summary",
  init: () => ({ count: 0, lastUpdated: 0 }),
  apply: (state, event) => ({
    ...state,
    count: state.count + 1,
    lastUpdated: event.timestamp,
  }),
  store: myFoldStore,  // { get, store } interface
};
```

The `store` must implement `FoldProjectionStore<StateType>`:

```typescript
interface FoldProjectionStore<T> {
  get(aggregateId: string, context: ProjectionStoreContext): Promise<T | null>;
  store(state: T, context: ProjectionStoreContext): Promise<void>;
}
```

### Map Projection

A map projection transforms individual events into records:

```typescript
import type { MapProjectionDefinition } from "~/server/event-sourcing";

const recordsMapProjection: MapProjectionDefinition<RecordType, MyEvent> = {
  name: "records",
  eventTypes: ["my.event.created"],
  map: (event) => ({
    id: event.id,
    data: event.data,
    timestamp: event.timestamp,
  }),
  store: myAppendStore,  // { append } interface
};
```

The `store` must implement `AppendStore<RecordType>`:

```typescript
interface AppendStore<T> {
  append(record: T, context: ProjectionStoreContext): Promise<void>;
}
```

### Reactor

A reactor fires after a fold projection succeeds:

```typescript
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";

const notifyReactor: ReactorDefinition<MyEvent, SummaryState> = {
  name: "notify",
  handle: async (event, { foldState, tenantId, aggregateId }) => {
    await broadcastService.send(tenantId, { type: "updated", aggregateId });
  },
  options: {
    delay: 500,
    makeJobId: ({ event }) => `notify:${event.aggregateId}`,
  },
};
```

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
  static readonly dispatcherName = "recordSpan" as const;
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

## Composition Root

The `PipelineRegistry` (in `pipelineRegistry.ts`) is the composition root. It creates store adapters, builds reactors and commands, then registers all pipelines:

```typescript
export class PipelineRegistry {
  registerAll() {
    const evalPipeline = this.registerEvaluationPipeline();
    const tracePipeline = this.registerTracePipeline(evalPipeline);
    const experimentRunPipeline = this.registerExperimentRunPipeline();
    const simulationPipeline = this.registerSimulationPipeline();

    return {
      traces: mapCommands(tracePipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
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
  queueProcessorFactory: new DefaultQueueProcessorFactory(null),
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
| `commands/` | Command handling: `Command`, `CommandHandlerClass`, `CommandSchema` |
| `pipeline/` | Static builder: `definePipeline()`, `StaticPipelineDefinition`, pipeline types |
| `services/` | `EventSourcingService` (main orchestration), `CommandDispatcher`, `QueueManager` |
| `projections/` | Projection executors: `FoldProjectionExecutor`, `MapProjectionExecutor`, `ProjectionRouter`, `ProjectionRegistry` |
| `reactors/` | Reactor type definitions |
| `queues/` | Queue implementations: `GroupQueue`, `SimpleQueue` (BullMQ), `MemoryQueue` |
| `stores/` | Event store implementations: `EventStoreClickHouse`, `EventStoreMemory`, projection store interfaces |
| `utils/` | `EventUtils` (event creation, validation), `KillSwitch` |
| `schemas/` | Shared type identifiers |

### Pipeline Implementations

Each pipeline follows the same internal structure:

```
pipelines/<name>/
  commands/         # Command handlers
  projections/      # Fold and map projection definitions + stores
  reactors/         # Reactor definitions
  repositories/     # Projection store implementations (ClickHouse + Memory)
  schemas/          # Event types, command schemas, constants
  utils/            # Pipeline-specific utilities
  pipeline.ts       # Pipeline factory function (createXxxPipeline)
  index.ts          # Public exports
```

**Active pipelines:**

| Pipeline | Aggregate | Purpose |
|----------|-----------|---------|
| `trace-processing` | `trace` | Ingests OTLP spans, builds trace summaries |
| `evaluation-processing` | `evaluation` | Runs evaluations, tracks evaluation state |
| `experiment-run-processing` | `experiment_run` | Tracks experiment runs with evaluator results |
| `simulation-processing` | `simulation_run` | Tracks simulation run lifecycle |

### Global Projections

SaaS-only cross-pipeline fold projections live in `projections/global/`:

| Projection | Purpose |
|------------|---------|
| `projectDailyBillableEvents` | Tracks billable event counts per project per day |
| `projectDailySdkUsage` | Tracks SDK usage per project per day |

### Entry Points

| File | Description |
|------|-------------|
| `index.ts` | Public exports for the module |
| `eventSourcing.ts` | `EventSourcing` central class (owns event store, queue factory, pipelines) |
| `pipelineRegistry.ts` | Composition root -- creates and registers all pipelines |
| `runtimePipeline.ts` | `EventSourcingPipeline` -- connects static definitions to runtime |
| `disabledPipeline.ts` | No-op pipeline returned when event sourcing is disabled |
| `mapCommands.ts` | Utility to convert command processors to typed dispatch functions |

## Common Pitfalls

1. **Missing tenant validation**: Always call `EventUtils.validateTenantId()` in store implementations.
2. **Reactor without fold**: Reactors must be registered on an existing fold projection (`withReactor(foldName, ...)`). The builder will throw if the fold does not exist.
3. **Fold store failures**: If `store.store()` fails, BullMQ retries the entire event. Make sure your store is idempotent or uses upsert semantics.
4. **Map projection ordering**: Map projections have no ordering guarantees. Do not rely on event order in append stores.
5. **Process role mismatch**: Commands dispatched in a `web` process are enqueued but not processed until a `worker` process picks them up. Ensure workers are running.
