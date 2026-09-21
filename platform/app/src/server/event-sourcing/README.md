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
  .withSubscriber("notify", { fold: "summary", handler: notifyHandler })
  .withCommand("doSomething", DoSomethingCommand)
  .build();
```

### Step 2: Register at Runtime

```typescript
const registered = eventSourcing.register(pipeline);

// Send commands
await registered.commands.doSomething.add({ tenantId: "acme", /* payload */ });
```

Registration connects the static definition to ClickHouse, Redis, and the in-house [GroupQueue](./queues/groupQueue/README.md) (no BullMQ). This happens in the composition root (`pipelineRegistry.ts`).

## Builder API

| Method | Description |
|--------|-------------|
| `.withName(name)` | Pipeline name (must be unique) |
| `.withAggregateType(type)` | Aggregate type for event grouping |
| `.withFoldProjection(name, definition, options?)` | Register a fold projection (stateful, ordered) |
| `.withMapProjection(name, definition, options?)` | Register a map projection (stateless, parallel) |
| `.withSubscriber(name, spec)` | Register best-effort side-effect work — on a fold, a map, or the live event stream |
| `.withProcessManager(name, spec)` | Register stake-sensitive orchestration (durable inbox, state, leased intents) |
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

### Subscriber

A subscriber is best-effort side-effect work. Declare it on the pipeline with
`.withSubscriber(name, spec)`. Name a `fold` and it fires after that fold
projection's apply + store succeeds, with the committed state in `context`; omit
`fold` and it runs off the live event stream instead.

```typescript
const pipeline = definePipeline<MyEvent>()
  .withFoldProjection("summary", summaryFoldProjection)
  .withSubscriber("notify", {
    fold: "summary",
    // Pre-enqueue guard — runs on the projection hot path, so keep it pure and
    // synchronous. Returning false skips the job entirely (ADR-069).
    when: (event, { state }) => state.count > 0,
    handler: async (event, { state, tenantId, aggregateId }) => {
      await broadcastService.send(tenantId, { type: "updated", aggregateId });
    },
    delay: 500,
    dedupId: ({ event }) => `notify:${event.aggregateId}`,
  })
  .build();
```

For stake-sensitive work — anything where a dropped side effect is a customer-
visible loss — use `.withProcessManager` instead. Those are the only two
options; see [ADR-098](../../../../dev/docs/adr/098-post-event-work-subscribers-and-process-managers.md).

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

The `PipelineRegistry` (in `pipelineRegistry.ts`) is the composition root. It creates store adapters, builds subscribers and commands, then registers all pipelines:

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
| `subscribers/` | Subscriber type definitions and the shared throttle-window helper |
| `queues/` | Queue implementations: `GroupQueue` (in-house, Redis + Lua — see [`queues/groupQueue/README.md`](./queues/groupQueue/README.md)) and `MemoryQueue` (in-process dev/test fallback) |
| `stores/` | Event store implementations: `EventStoreClickHouse`, `EventStoreMemory`, projection store interfaces |
| `utils/` | `EventUtils` (event creation, validation), `KillSwitch` |
| `schemas/` | Shared type identifiers |

### Pipeline Implementations

Each pipeline follows the same internal structure:

```
pipelines/<name>/
  commands/         # Command handlers
  projections/      # Fold and map projection definitions + stores
  subscribers/      # Subscriber definitions
  process-manager/  # Process-manager definitions, where the pipeline has one
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
2. **Subscriber naming a fold that does not exist**: a subscriber declared with `fold:` must name an already-registered fold projection. The builder throws at `build()` if it does not exist.
3. **Fold store failures**: If `store.store()` fails, GroupQueue retries the entire event (with exponential backoff in front of the same group, preserving FIFO). Make sure your store is idempotent or uses upsert semantics.
4. **Map projection ordering**: Map projections have no ordering guarantees. Do not rely on event order in append stores.
5. **Process role mismatch**: Commands dispatched in a `web` process are enqueued but not processed until a `worker` process picks them up. Ensure workers are running.
