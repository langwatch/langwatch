import { type ClickHouseClient } from "@clickhouse/client";
import { getClickHouseClient } from "../../../utils/clickhouse";
import { EventStoreClickHouse } from "../stores/eventStoreClickHouse";
import { EventStoreMemory } from "../stores/eventStoreMemory";
import { CheckpointRepositoryClickHouse } from "../stores/checkpointRepositoryClickHouse";
import { CheckpointRepositoryMemory } from "../stores/checkpointRepositoryMemory";
import type {
  Event,
  Projection,
  EventStore,
  ProjectionStore,
  EventHandler,
  AggregateType,
  CheckpointRepository,
} from "../library";
import { EventSourcingPipeline, type RegisteredPipeline } from "./index";

/**
 * Builder for creating event sourcing pipelines with type-safe required fields.
 * Uses TypeScript type state machine pattern to enforce that all required fields
 * are provided before build() can be called.
 *
 * **Builder Pattern Flow:**
 * 1. Start with `registerPipeline()` which returns `PipelineBuilder`
 * 2. Call `withName(name)` → returns `PipelineBuilderWithName`
 * 3. Call `withAggregateType(type)` → returns `PipelineBuilderWithNameAndType`
 * 4. Call either `withProjectionStore(store)` or `withEventHandler(handler)`
 *    - `withProjectionStore` → returns `PipelineBuilderWithStore`
 *    - `withEventHandler` → returns `PipelineBuilderWithHandler`
 * 5. Call the remaining method to get `PipelineBuilderComplete`
 * 6. Call `build()` to create the `RegisteredPipeline`
 *
 * **Example:**
 * ```typescript
 * const pipeline = eventSourcing
 *   .registerPipeline<MyEvent, MyProjection>()
 *   .withName("my-pipeline")
 *   .withAggregateType("trace")
 *   .withProjectionStore(store)
 *   .withEventHandler(handler)
 *   .build();
 * ```
 */
class PipelineBuilder<
  EventType extends Event<string>,
  ProjectionType extends Projection<string>,
> {
  private name?: string;
  private aggregateType?: AggregateType;
  private projectionStore?: ProjectionStore<string, ProjectionType>;
  private eventHandler?: EventHandler<string, EventType, ProjectionType>;

  constructor(private readonly eventStore: EventStore<string, any>) {}

  withName(name: string): PipelineBuilderWithName<EventType, ProjectionType> {
    this.name = name;
    return new PipelineBuilderWithName(this.eventStore, name);
  }

  build(): never {
    throw new Error("Pipeline name is required");
  }
}

class PipelineBuilderWithName<
  EventType extends Event<string>,
  ProjectionType extends Projection<string>,
> {
  constructor(
    private readonly eventStore: EventStore<string, any>,
    private readonly name: string,
  ) {}

  withAggregateType(
    aggregateType: AggregateType,
  ): PipelineBuilderWithNameAndType<EventType, ProjectionType> {
    return new PipelineBuilderWithNameAndType(
      this.eventStore,
      this.name,
      aggregateType,
    );
  }

  build(): never {
    throw new Error("Aggregate type is required");
  }
}

class PipelineBuilderWithNameAndType<
  EventType extends Event<string>,
  ProjectionType extends Projection<string>,
> {
  private projectionStore?: ProjectionStore<string, ProjectionType>;
  private eventHandler?: EventHandler<string, EventType, ProjectionType>;

  constructor(
    private readonly eventStore: EventStore<string, any>,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
  ) {}

  withProjectionStore(
    store: ProjectionStore<string, ProjectionType>,
  ): PipelineBuilderWithStore<EventType, ProjectionType> {
    this.projectionStore = store;
    return new PipelineBuilderWithStore(
      this.eventStore,
      this.name,
      this.aggregateType,
      store,
      this.eventHandler,
    );
  }

  withEventHandler(
    handler: EventHandler<string, EventType, ProjectionType>,
  ): PipelineBuilderWithHandler<EventType, ProjectionType> {
    this.eventHandler = handler;
    return new PipelineBuilderWithHandler(
      this.eventStore,
      this.name,
      this.aggregateType,
      this.projectionStore,
      handler,
    );
  }

  build(): never {
    throw new Error("Projection store is required");
  }
}

class PipelineBuilderWithStore<
  EventType extends Event<string>,
  ProjectionType extends Projection<string>,
> {
  private eventHandler?: EventHandler<string, EventType, ProjectionType>;

  constructor(
    private readonly eventStore: EventStore<string, any>,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
    private readonly projectionStore: ProjectionStore<string, ProjectionType>,
    private readonly existingHandler?: EventHandler<
      string,
      EventType,
      ProjectionType
    >,
  ) {
    this.eventHandler = existingHandler;
  }

  withEventHandler(
    handler: EventHandler<string, EventType, ProjectionType>,
  ): PipelineBuilderComplete<EventType, ProjectionType> {
    if (!this.projectionStore) {
      throw new Error("Projection store must be set before event handler");
    }
    return new PipelineBuilderComplete(
      this.eventStore,
      this.name,
      this.aggregateType,
      this.projectionStore,
      handler,
    );
  }

  build(): never {
    throw new Error("Event handler is required");
  }
}

class PipelineBuilderWithHandler<
  EventType extends Event<string>,
  ProjectionType extends Projection<string>,
> {
  private projectionStore?: ProjectionStore<string, ProjectionType>;

  constructor(
    private readonly eventStore: EventStore<string, any>,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
    private readonly existingStore?: ProjectionStore<string, ProjectionType>,
    private readonly eventHandler?: EventHandler<
      string,
      EventType,
      ProjectionType
    >,
  ) {
    this.projectionStore = existingStore;
  }

  withProjectionStore(
    store: ProjectionStore<string, ProjectionType>,
  ): PipelineBuilderComplete<EventType, ProjectionType> {
    if (!this.eventHandler) {
      throw new Error("Event handler must be set before projection store");
    }
    return new PipelineBuilderComplete(
      this.eventStore,
      this.name,
      this.aggregateType,
      store,
      this.eventHandler,
    );
  }

  build(): never {
    throw new Error("Projection store is required");
  }
}

class PipelineBuilderComplete<
  EventType extends Event<string>,
  ProjectionType extends Projection<string>,
> {
  constructor(
    private readonly eventStore: EventStore<string, any>,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
    private readonly projectionStore: ProjectionStore<string, ProjectionType>,
    private readonly eventHandler: EventHandler<
      string,
      EventType,
      ProjectionType
    >,
  ) {}

  build(): RegisteredPipeline<string, EventType, ProjectionType> {
    if (!this.name) {
      throw new Error("Pipeline name is required");
    }
    if (!this.aggregateType) {
      throw new Error("Aggregate type is required");
    }
    if (!this.projectionStore) {
      throw new Error("Projection store is required");
    }
    if (!this.eventHandler) {
      throw new Error("Event handler is required");
    }

    return new EventSourcingPipeline<string, EventType, ProjectionType>({
      name: this.name,
      aggregateType: this.aggregateType,
      eventStore: this.eventStore as EventStore<string, EventType>,
      projectionStore: this.projectionStore,
      eventHandler: this.eventHandler,
    });
  }
}

/**
 * Singleton that manages shared event sourcing infrastructure.
 * Provides a single event store and checkpoint repository instance
 * that can be used by all pipelines, since the database partitions
 * by tenantId + aggregateType.
 *
 * **Design Considerations:**
 * - Uses singleton pattern for simplicity and shared state
 * - Automatically selects ClickHouse or Memory store based on availability
 * - Suitable for applications with a single database connection
 *
 * **Future Enhancement - Dependency Injection:**
 * For better testability and flexibility, consider refactoring to use
 * dependency injection instead of singleton pattern:
 *
 * ```typescript
 * class EventSourcing {
 *   constructor(
 *     private readonly eventStore: EventStore,
 *     private readonly checkpointRepository: CheckpointRepository
 *   ) {}
 * }
 * ```
 *
 * This would allow:
 * - Easier unit testing with mock stores
 * - Multiple instances with different configurations
 * - Better separation of concerns
 * - More explicit dependencies
 *
 * However, the current singleton approach is simpler and sufficient for
 * most use cases where a single shared store is desired.
 */
export class EventSourcing {
  private static instance: EventSourcing | null = null;
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly eventStore: EventStore<string, any>;
  private readonly checkpointRepository: CheckpointRepository<string>;

  private constructor() {
    this.clickHouseClient = getClickHouseClient();
    this.eventStore = this.clickHouseClient
      ? new EventStoreClickHouse<string, any>(this.clickHouseClient)
      : new EventStoreMemory<string, any>();
    this.checkpointRepository = this.clickHouseClient
      ? new CheckpointRepositoryClickHouse(this.clickHouseClient)
      : new CheckpointRepositoryMemory();
  }

  static getInstance(): EventSourcing {
    if (!EventSourcing.instance) {
      EventSourcing.instance = new EventSourcing();
    }
    return EventSourcing.instance;
  }

  /**
   * Returns the shared event store instance.
   * This single instance handles all aggregate types by accepting
   * aggregateType as a method parameter.
   */
  getEventStore<EventType extends Event<string>>(): EventStore<
    string,
    EventType
  > {
    return this.eventStore as EventStore<string, EventType>;
  }

  /**
   * Returns the shared checkpoint repository instance.
   * This single instance handles all aggregate types.
   */
  getCheckpointRepository(): CheckpointRepository<string> {
    return this.checkpointRepository;
  }

  /**
   * Starts building a new event sourcing pipeline.
   * Returns a builder that enforces required fields through TypeScript types.
   */
  registerPipeline<
    EventType extends Event<string>,
    ProjectionType extends Projection<string>,
  >(): PipelineBuilder<EventType, ProjectionType> {
    return new PipelineBuilder<EventType, ProjectionType>(this.eventStore);
  }
}

// Export singleton instance
export const eventSourcing = EventSourcing.getInstance();
