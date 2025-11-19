# Event Sourcing Library - Core Concepts & Architecture

A high-level overview of the event sourcing library's core concepts, architecture, and capabilities. For implementation details, see [README.md](./README.md).

## Core Philosophy

Event sourcing stores **immutable events** rather than mutable state. Current state is derived by replaying events through **projections** (computed views). This enables:

- **Time travel**: Rebuild state at any point in time
- **Debugging**: See exactly what happened and when
- **Multiple views**: Create different projections from the same events
- **Audit trail**: Complete history of all changes

## Core Concepts

### Events

Events are immutable facts that represent something that happened. They are the source of truth.

**Key properties:**

- `id`: Unique identifier
- `aggregateId`: The aggregate this event belongs to
- `tenantId`: Multi-tenant isolation
- `timestamp`: When it occurred
- `type`: Event type for routing
- `data`: Event-specific payload

See: [`domain/types.ts`](./domain/types.ts#L18-L33)

### Commands

Commands represent **intent** to perform an action. They are validated and processed by command handlers, which produce events.

**Flow:** Command → Command Handler → Events

See: [`commands/command.ts`](./commands/command.ts)

### Projections

Projections are **computed views** built by replaying events through projection handlers. They represent the current state of an aggregate from a specific perspective.

**Key properties:**

- Built from events (never directly modified)
- Can be rebuilt at any time
- Multiple projections can exist for the same aggregate
- Stored separately for fast queries

See: [`domain/types.ts`](./domain/types.ts#L39-L50)

### Event Handlers (Side Effects)

Event handlers react to individual events and perform side effects (e.g., writing to ClickHouse, triggering external processes). They process events asynchronously via queues.

See: [`domain/handlers/eventReactionHandler.ts`](./domain/handlers/eventReactionHandler.ts)

## Architecture Overview

```mermaid
graph TB
    subgraph "Command Layer"
        C[Command] --> CH[Command Handler]
        CH --> E[Events]
    end

    subgraph "Event Store"
        E --> ES[(Event Store)]
        ES --> |"Read Events"| ER[Event Retrieval]
    end

    subgraph "Side Effects"
        E --> |"Async Queue"| EH1[Event Handler 1]
        E --> |"Async Queue"| EH2[Event Handler 2]
        E --> |"Async Queue"| EP[Event Publisher]
        EH1 --> |"Dependency"| EH2
    end

    subgraph "Projection Layer"
        ER --> |"Event Stream"| PH[Projection Handler]
        PH --> P[Projection]
        P --> PS[(Projection Store)]
    end

    style ES fill:#e1f5ff
    style PS fill:#fff4e1
    style E fill:#ffe1f5
    style P fill:#e1ffe1
```

**Key flow:**

1. Commands are sent and processed by command handlers
2. Command handlers produce events
3. Events are stored in the event store (immutable, append-only)
4. Events trigger side effects (handlers, publishing) asynchronously
5. Events are replayed through projection handlers to build projections
6. Projections are stored separately for fast queries

See: [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L145-L186) for the `storeEvents` implementation.

## Guaranteed Ordering & Consistency

### Event Ordering Within Aggregates

Events for the same aggregate are **guaranteed to be processed in order**. This is critical for maintaining consistency when building projections.

**How it works:**

1. **Event Storage**: Events are stored scoped to `tenantId + aggregateId + aggregateType`
2. **Event Retrieval**: The event store returns events for a specific aggregate, typically ordered by timestamp
3. **EventStream Ordering**: The `EventStream` class ensures events are always in chronological order before being passed to projection handlers

```mermaid
graph LR
    ES[(Event Store)] --> |"Get Events<br/>tenantId + aggregateId"| ER[Event Retrieval]
    ER --> |"Raw Events"| ESort[EventStream<br/>Sorting]
    ESort --> |"Ordered Events<br/>by timestamp"| PH[Projection Handler]

    style ESort fill:#ffe1f5
    style PH fill:#e1ffe1
```

**Ordering strategies:**

- **`timestamp`** (default): Events sorted chronologically by `timestamp` field
- **`as-is`**: Preserves order from event store (use when DB pre-sorts)
- **Custom function**: Provide a comparator for custom sorting logic

**Tenant Isolation:**

- All event queries are scoped to `tenantId + aggregateId + aggregateType`
- Events from different tenants are never mixed, even if they share the same aggregateId
- The event store validates tenantId before any operations

See: [`streams/eventStream.ts`](./streams/eventStream.ts#L38-L68) for ordering implementation and [`stores/eventStore.types.ts`](./stores/eventStore.types.ts#L11-L12) for concurrency guarantees.

### Concurrent Projection Updates

When multiple processes try to update the same projection simultaneously, **distributed locking** prevents race conditions and ensures consistency.

**Lock Scope:**

- Locks are scoped to: `aggregateType + aggregateId + projectionName`
- Each tenant's aggregates are isolated (tenantId is validated in context, and aggregateIds are unique per tenant)
- Only updates to the **same aggregate's projection** are serialized

```mermaid
sequenceDiagram
    participant P1 as Process 1
    participant P2 as Process 2
    participant DL as Distributed Lock
    participant PS as Projection Store

    P1->>DL: Acquire lock<br/>update:trace:trace-123:summary
    DL-->>P1: Lock acquired
    P2->>DL: Acquire lock<br/>update:trace:trace-123:summary
    DL-->>P2: Lock unavailable
    P2->>P2: Retry later (via queue)
    P1->>PS: Update projection
    P1->>DL: Release lock
    P2->>DL: Acquire lock (retry)
    DL-->>P2: Lock acquired
    P2->>PS: Update projection
    P2->>DL: Release lock
```

**Why per-aggregate locking:**

- Different aggregates can be updated concurrently (no contention)
- Only updates to the **same aggregate's projection** are serialized
- This maximizes parallelism while ensuring consistency

**Note:** Without distributed locking in production, concurrent updates to the same aggregate projection may result in lost updates. See: [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L598-L608) for lock implementation.

## Side Effects: Event Handlers & Publishing

After events are stored, they trigger side effects through two mechanisms:

### Event Handlers

Event handlers process individual events asynchronously via queues. They can:

- Filter by event type
- Have dependencies on other handlers (executed in order)
- Be idempotent (via job IDs)
- Have concurrency limits

```mermaid
sequenceDiagram
    participant ES as Event Store
    participant Q as Queue System
    participant EH1 as Handler 1
    participant EH2 as Handler 2

    ES->>Q: Dispatch Event
    Q->>EH1: Process (async)
    EH1->>EH1: Side Effect
    EH1->>Q: Complete
    Q->>EH2: Process (depends on EH1)
    EH2->>EH2: Side Effect
    EH2->>Q: Complete
```

**Handler dependencies:** Handlers are topologically sorted to respect dependencies. See: [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L474-L555)

**Queue processing:** Handlers are dispatched to queues for async processing. See: [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L317-L414)

### Event Publishing

Events can be published to external systems (message queues, event buses) after successful storage. Publishing failures are logged but don't fail event storage.

See: [`publishing/eventPublisher.types.ts`](./publishing/eventPublisher.types.ts) and [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L152-L175)

## Time Travel & Debugging

One of the most powerful features of event sourcing is the ability to rebuild state at any point in time.

### Rebuilding Projections

Projections can be rebuilt by replaying events up to a specific timestamp:

```mermaid
graph LR
    ES[(Event Store)] --> |"Get Events<br/>up to timestamp"| FS[Filtered Stream]
    FS --> PH[Projection Handler]
    PH --> |"Rebuild"| P[Projection at Time T]

    style P fill:#e1ffe1
    style FS fill:#ffe1f5
```

**Implementation:** See [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L1013-L1020) for `replayEvents` (time travel support).

**Manual projection updates:** You can manually rebuild projections for debugging or recovery. See: [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L662-L818)

### Event Streams

Events are provided to projection handlers as **EventStream** objects, which:

- Guarantee chronological ordering (unless `as-is` ordering is used)
- Provide metadata (event count, first/last timestamps)
- Enable time-based filtering

See: [`streams/eventStream.ts`](./streams/eventStream.ts)

### Debugging Workflow

1. **Inspect events:** Query the event store for all events for an aggregate
2. **Rebuild at timestamp:** Use `replayEvents` to see state at a specific time
3. **Compare projections:** Rebuild projections at different timestamps to see state evolution
4. **Event timeline:** Use event timestamps and metadata to understand the sequence of changes

## Multiple Projections for Different Views

A single aggregate can have multiple projections, each providing a different view of the same events.

```mermaid
graph TB
    ES[(Event Store)] --> |"Same Events"| PH1[Projection Handler 1]
    ES --> |"Same Events"| PH2[Projection Handler 2]
    ES --> |"Same Events"| PH3[Projection Handler 3]

    PH1 --> P1[Summary Projection]
    PH2 --> P2[Analytics Projection]
    PH3 --> P3[Search Index]

    P1 --> PS1[(Projection Store 1)]
    P2 --> PS2[(Projection Store 2)]
    P3 --> PS3[(Projection Store 3)]

    style ES fill:#e1f5ff
    style P1 fill:#e1ffe1
    style P2 fill:#e1ffe1
    style P3 fill:#e1ffe1
```

**Use cases:**

- **Summary view:** Fast, denormalized view for UI
- **Analytics view:** Aggregated metrics and statistics
- **Search index:** Full-text searchable representation
- **Reporting view:** Pre-computed reports

**Registration:** Multiple projections are registered via the pipeline builder. See: [`runtime/pipeline/builder.ts`](./runtime/pipeline/builder.ts#L306-L332)

**Access:** Each projection is accessed by name. See: [`services/eventSourcingService.ts`](./services/eventSourcingService.ts#L912-L940)

## Understanding State Over Time

Event sourcing makes it easy to understand how state evolved over time:

### Event Timeline

Events are stored with timestamps, creating a complete timeline:

```mermaid
timeline
    title Aggregate State Evolution
    T1 : Event 1 : State A
    T2 : Event 2 : State B
    T3 : Event 3 : State C
    T4 : Event 4 : State D
```

### Projection Metadata

Projections include metadata about the events that produced them:

- `eventCount`: Number of events processed
- `firstEventTimestamp`: When the first event occurred
- `lastEventTimestamp`: When the last event occurred
- `computedAtUnixMs`: When the projection was computed

See: [`domain/types.ts`](./domain/types.ts#L55-L64)

### Simple View Models

Projections act as simple view models that:

- Hide event complexity behind a simple interface
- Can be queried efficiently (stored separately)
- Can be rebuilt if the projection logic changes
- Represent state at a point in time

**Example:** A trace projection might aggregate all span events into a simple `{ spans: [], metadata: {} }` structure, hiding the complexity of individual span events.

## Pipeline Registration

Pipelines are registered using a fluent builder pattern:

```mermaid
graph LR
    Start[registerPipeline] --> Name[withName]
    Name --> Type[withAggregateType]
    Type --> Config{Configure}
    Config --> |"Projections"| Proj[withProjection]
    Config --> |"Handlers"| Hand[withEventHandler]
    Config --> |"Commands"| Cmd[withCommandHandler]
    Config --> |"Publishing"| Pub[withEventPublisher]
    Proj --> Build[build]
    Hand --> Build
    Cmd --> Build
    Pub --> Build
    Build --> Pipeline[Registered Pipeline]
```

**Type safety:** The builder enforces required fields through TypeScript's type system. See: [`runtime/pipeline/builder.ts`](./runtime/pipeline/builder.ts#L195-L541)

## Key Implementation Files

- **Core types:** [`domain/types.ts`](./domain/types.ts)
- **Event streams:** [`streams/eventStream.ts`](./streams/eventStream.ts)
- **Main service:** [`services/eventSourcingService.ts`](./services/eventSourcingService.ts)
- **Pipeline builder:** [`runtime/pipeline/builder.ts`](./runtime/pipeline/builder.ts)
- **Command handling:** [`commands/commandHandlerClass.ts`](./commands/commandHandlerClass.ts)
- **Event handlers:** [`domain/handlers/eventReactionHandler.ts`](./domain/handlers/eventReactionHandler.ts)
- **Projection handlers:** [`domain/handlers/eventHandler.ts`](./domain/handlers/eventHandler.ts)
- **Distributed locking:** [`utils/distributedLock.ts`](./utils/distributedLock.ts)

## Next Steps

- **Implementation guide:** See [README.md](./README.md) for code examples and patterns
- **Security & concurrency:** See the security guide for tenant isolation and distributed locking
- **Store interfaces:** See `stores/` directory for implementing custom stores
