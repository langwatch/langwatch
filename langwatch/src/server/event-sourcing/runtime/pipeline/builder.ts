import type {
  AggregateType,
  CommandHandlerClass,
  Event,
  EventHandlerClass,
  EventPublisher,
  EventSourcedQueueProcessor,
  EventStore,
  EventStoreReadContext,
  ExtractCommandHandlerPayload,
  Projection,
  ProjectionHandlerClass,
} from "../../library";
import type {
  EventHandlerDefinition,
  EventHandlerOptions,
} from "../../library/eventHandler.types";
import type { ProjectionDefinition } from "../../library/projection.types";
import { ConfigurationError } from "../../library/services/errorHandling";
import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { DistributedLock } from "../../library/utils/distributedLock";
import { EventSourcingPipeline } from "../index";
import type { QueueProcessorFactory } from "../queue";
import { defaultQueueProcessorFactory } from "../queue";
import type { PipelineWithCommandHandlers, RegisteredPipeline } from "./types";

export interface PipelineBuilderOptions {
  eventStore: EventStore<any>;
  queueProcessorFactory?: QueueProcessorFactory;
  distributedLock?: DistributedLock;
  handlerLockTtlMs?: number;
  updateLockTtlMs?: number;
  processorCheckpointStore?: ProcessorCheckpointStore;
}

/**
 * Options for configuring a command handler.
 * All options are optional and will fall back to static methods on the handler class if not provided.
 */
export interface CommandHandlerOptions<Payload> {
  /**
   * Optional: Function to extract aggregate ID from payload.
   * Default: Uses static getAggregateId from handler class
   */
  getAggregateId?: (payload: Payload) => string;

  /**
   * Optional: Custom job ID factory for idempotency.
   * Default: Uses static makeJobId from handler class, or auto-generated
   */
  makeJobId?: (payload: Payload) => string;

  /**
   * Optional: Delay in milliseconds before processing the job.
   * Default: Uses static delay from handler class, or 0
   */
  delay?: number;

  /**
   * Optional: Concurrency limit for processing jobs.
   * Default: Uses static concurrency from handler class, or 5
   */
  concurrency?: number;

  /**
   * Optional: Function to extract span attributes from the payload.
   * Default: Uses static getSpanAttributes from handler class
   */
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
}

/**
 * Builder for creating event sourcing pipelines with type-safe required fields.
 * Uses TypeScript type state machine pattern to enforce that all required fields
 * are provided before build() can be called.
 *
 * **Builder Pattern Flow:**
 * 1. Start with `registerPipeline()` which returns `PipelineBuilder`
 * 2. Call `withName(name)` → returns `PipelineBuilderWithName`
 * 3. Call `withAggregateType(type)` → returns `PipelineBuilderWithNameAndType`
 * 4. Optionally call `withProjection(name, HandlerClass)` multiple times to register projections
 * 5. Optionally call `withEventPublisher(publisher)` to register an event publisher
 * 6. Optionally call `withEventHandler(name, HandlerClass, options?)` to register event handlers
 * 7. Optionally call `withCommand(name, HandlerClass, options?)` to register command handlers
 * 8. Call `build()` to create the `RegisteredPipeline`
 *
 * **Example:**
 * ```typescript
 * const pipeline = eventSourcing
 *   .registerPipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("trace")
 *   .withProjection("summary", SummaryProjectionHandler)
 *   .withProjection("analytics", AnalyticsProjectionHandler)
 *   .withEventPublisher(publisher)
 *   .withEventHandler("span-storage", SpanClickHouseHandler, { eventTypes: [...] })
 *   .withCommand("recordSpan", RecordSpanCommand, { delay: 5000 })
 *   .build();
 * ```
 */
export class PipelineBuilder<
  EventType extends Event,
  ProjectionType extends Projection,
> {
  constructor(private readonly options: PipelineBuilderOptions) {}

  withName(name: string): PipelineBuilderWithName<EventType, ProjectionType> {
    return new PipelineBuilderWithName(this.options, name);
  }

  build(): never {
    throw new ConfigurationError(
      "PipelineBuilder",
      "Pipeline name is required",
    );
  }
}

export class PipelineBuilderWithName<
  EventType extends Event,
  ProjectionType extends Projection,
> {
  constructor(
    private readonly options: PipelineBuilderOptions,
    private readonly name: string,
  ) {}

  withAggregateType(
    aggregateType: AggregateType,
  ): PipelineBuilderWithNameAndType<EventType, ProjectionType, never, never> {
    return new PipelineBuilderWithNameAndType(
      this.options,
      this.name,
      aggregateType,
    );
  }

  build(): never {
    throw new ConfigurationError(
      "PipelineBuilder",
      "Aggregate type is required",
    );
  }
}

interface CommandHandlerRegistration<EventType extends Event = Event> {
  HandlerClass: CommandHandlerClass<any, any, EventType>;
  name: string;
  options?: CommandHandlerOptions<any>;
}

/**
 * Represents a registered command handler with its dispatcher name and payload type.
 */
type RegisteredCommandHandler = {
  name: string;
  payload: unknown;
};

/**
 * Converts a union of RegisteredCommandHandler objects into a Record type
 * mapping dispatcher names to their payload types.
 */
type CommandHandlersToRecord<Handlers extends RegisteredCommandHandler> = {
  [K in Handlers as K["name"]]: EventSourcedQueueProcessor<K["payload"]>;
};

export class PipelineBuilderWithNameAndType<
  EventType extends Event,
  ProjectionType extends Projection,
  RegisteredHandlerNames extends string = never,
  RegisteredCommandHandlers extends RegisteredCommandHandler = never,
> {
  private projections = new Map<
    string,
    ProjectionDefinition<EventType, Projection>
  >();
  private eventPublisher?: EventPublisher<EventType>;
  private eventHandlers = new Map<
    string,
    EventHandlerDefinition<EventType, RegisteredHandlerNames>
  >();
  private commandHandlers: Array<CommandHandlerRegistration<EventType>> = [];

  constructor(
    private readonly options: PipelineBuilderOptions,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
  ) {}

  /**
   * Register a projection handler class with a unique name.
   * The handler class must have a static `store` property.
   * This method can be called multiple times to register multiple projections.
   *
   * @param name - Unique name for this projection within the pipeline
   * @param HandlerClass - Projection handler class to register (must have static `store` property)
   * @returns The same builder instance for method chaining
   * @throws Error if projection name already exists or if handler class doesn't have static store property
   *
   * @example
   * ```typescript
   * pipeline
   *   .withProjection("summary", SummaryProjectionHandler)
   *   .withProjection("analytics", AnalyticsProjectionHandler)
   * ```
   */
  withProjection<
    HandlerClass extends ProjectionHandlerClass<EventType, any>,
    ProjectionName extends string,
  >(
    name: ProjectionName,
    HandlerClass: HandlerClass,
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames,
    RegisteredCommandHandlers
  > {
    if (this.projections.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Projection with name "${name}" already exists. Projection names must be unique within a pipeline.`,
        { projectionName: name },
      );
    }

    // Extract store from static property
    if (!HandlerClass.store) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Projection handler class must have a static "store" property.`,
        { projectionName: name },
      );
    }

    // Instantiate handler
    const handler = new HandlerClass();

    this.projections.set(name, {
      name,
      store: HandlerClass.store,
      handler,
    } as ProjectionDefinition<EventType, any>);

    return this;
  }

  /**
   * Register an event publisher for publishing events to external systems.
   * Events are published after they are successfully stored in the event store.
   *
   * @param publisher - The event publisher implementation
   * @returns The same builder instance for method chaining
   *
   * @example
   * ```typescript
   * pipeline.withEventPublisher(new KafkaEventPublisher());
   * ```
   */
  withEventPublisher(
    publisher: EventPublisher<EventType>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames,
    RegisteredCommandHandlers
  > {
    this.eventPublisher = publisher;
    return this;
  }

  /**
   * Register an event handler class that reacts to individual events.
   * Handlers are dispatched asynchronously via queues after events are stored.
   *
   * @param name - Unique name for this handler within the pipeline
   * @param HandlerClass - Event handler class to register
   * @param options - Options for configuring the handler (event types, idempotency, etc.)
   * @returns A new builder instance with the handler name added to the registered names type
   * @throws Error if handler name already exists
   *
   * @example
   * ```typescript
   * pipeline
   *   .withEventHandler("span-storage", SpanClickHouseHandler, {
   *     eventTypes: ["lw.obs.span_ingestion.recorded"],
   *   })
   *   .withEventHandler("trace-aggregator", TraceHandler)
   * ```
   */
  withEventHandler<
    HandlerClass extends EventHandlerClass<EventType>,
    HandlerName extends string,
  >(
    name: HandlerName,
    HandlerClass: HandlerClass,
    options?: EventHandlerOptions<EventType, RegisteredHandlerNames>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames | HandlerName,
    RegisteredCommandHandlers
  > {
    if (this.eventHandlers.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Event handler with name "${name}" already exists. Handler names must be unique within a pipeline.`,
        { handlerName: name },
      );
    }

    // Instantiate handler
    const handler = new HandlerClass();

    // Merge event types from static method and options (options take precedence)
    const mergedOptions: EventHandlerOptions<
      EventType,
      RegisteredHandlerNames
    > = {
      ...options,
      eventTypes:
        options?.eventTypes ?? HandlerClass.getEventTypes?.() ?? void 0,
    };

    this.eventHandlers.set(name, {
      name,
      handler,
      options: mergedOptions,
    } as EventHandlerDefinition<EventType, RegisteredHandlerNames>);

    return this as PipelineBuilderWithNameAndType<
      EventType,
      ProjectionType,
      RegisteredHandlerNames | HandlerName,
      RegisteredCommandHandlers
    >;
  }

  /**
   * Register a self-contained command handler class.
   * The class bundles schema, handler implementation, and all configuration methods.
   *
   * @param name - Unique name for this command handler within the pipeline
   * @param HandlerClass - The command handler class to register
   * @param options - Optional configuration that can override static methods (delay, concurrency, etc.)
   * @returns A new builder instance with the command handler tracked in the type system
   *
   * @example
   * ```typescript
   * pipeline.withCommand("recordSpan", RecordSpanCommand);
   * pipeline.withCommand("recordSpan", RecordSpanCommand, { delay: 5000, concurrency: 10 });
   * ```
   */
  withCommand<
    HandlerClass extends CommandHandlerClass<any, any, EventType>,
    Name extends string,
  >(
    name: Name,
    HandlerClass: HandlerClass,
    options?: CommandHandlerOptions<ExtractCommandHandlerPayload<HandlerClass>>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames,
    | RegisteredCommandHandlers
    | {
        name: Name;
        payload: ExtractCommandHandlerPayload<HandlerClass>;
      }
  > {
    // Validate uniqueness
    if (this.commandHandlers.some((reg) => reg.name === name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Command handler with name "${name}" already exists. Command handler names must be unique within a pipeline.`,
        { commandHandlerName: name },
      );
    }

    this.commandHandlers.push({
      HandlerClass,
      name,
      options,
    });

    return this as PipelineBuilderWithNameAndType<
      EventType,
      ProjectionType,
      RegisteredHandlerNames,
      | RegisteredCommandHandlers
      | {
          name: Name;
          payload: ExtractCommandHandlerPayload<HandlerClass>;
        }
    >;
  }

  build(): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionType>,
    RegisteredCommandHandlers extends never
      ? Record<string, EventSourcedQueueProcessor<any>>
      : CommandHandlersToRecord<RegisteredCommandHandlers>
  > {
    // Convert projections map to object format
    const projectionsObject =
      this.projections.size > 0 ? Object.fromEntries(this.projections) : void 0;

    // Convert event handlers map to object format
    const eventHandlersObject =
      this.eventHandlers.size > 0
        ? Object.fromEntries(this.eventHandlers)
        : void 0;

    const pipeline = new EventSourcingPipeline<EventType, ProjectionType>({
      name: this.name,
      aggregateType: this.aggregateType,
      eventStore: this.options.eventStore as EventStore<EventType>,
      projections: projectionsObject,
      eventPublisher: this.eventPublisher,
      eventHandlers: eventHandlersObject,
      queueProcessorFactory: this.options.queueProcessorFactory,
      distributedLock: this.options.distributedLock,
      handlerLockTtlMs: this.options.handlerLockTtlMs,
      updateLockTtlMs: this.options.updateLockTtlMs,
      processorCheckpointStore: this.options.processorCheckpointStore,
    });

    // Create dispatchers now that we have the service
    // The service's storeEvents method will handle storing events and dispatching to handlers
    const storeEventsFn = async (
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => {
      await pipeline.service.storeEvents(events, context);
    };

    // Initialize command queues using the service's queue manager
    if (this.commandHandlers.length > 0) {
      const queueManager = pipeline.service.getQueueManager();
      queueManager.initializeCommandQueues(
        this.commandHandlers.map((reg) => ({
          name: reg.name,
          HandlerClass: reg.HandlerClass,
          options: reg.options,
        })),
        storeEventsFn,
        this.name,
      );
    }

    // Get command dispatchers from the queue manager and attach to pipeline
    const commandProcessors = pipeline.service
      .getQueueManager()
      .getCommandQueueProcessors();
    const dispatchers: Record<string, EventSourcedQueueProcessor<any>> = {};
    for (const [commandName, processor] of commandProcessors.entries()) {
      dispatchers[commandName] = processor;
    }

    // Attach dispatchers under a `commands` property
    // Type assertion is safe because we track the command handlers in the type system
    // and create dispatchers that match those types at runtime
    return Object.assign(pipeline, {
      commands: dispatchers,
    }) as unknown as PipelineWithCommandHandlers<
      RegisteredPipeline<EventType, ProjectionType>,
      RegisteredCommandHandlers extends never
        ? Record<string, EventSourcedQueueProcessor<any>>
        : CommandHandlersToRecord<RegisteredCommandHandlers>
    >;
  }
}
