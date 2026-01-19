import type {
  AggregateType,
  CommandHandlerClass,
  DeduplicationConfig,
  Event,
  EventHandlerClass,
  EventPublisher,
  EventSourcedQueueProcessor,
  EventStore,
  EventStoreReadContext,
  ExtractCommandHandlerPayload,
  ParentLink,
  Projection,
  ProjectionHandlerClass,
} from "../../library";
import type { ExtractProjectionHandlerProjection } from "../../library/domain/handlers/projectionHandlerClass";
import type {
  EventHandlerDefinition,
  EventHandlerOptions,
} from "../../library/eventHandler.types";
import type {
  ProjectionDefinition,
  ProjectionDefinitions,
  ProjectionOptions,
  ProjectionTypeMap,
} from "../../library/projection.types";
import { ConfigurationError } from "../../library/services/errorHandling";
import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { DistributedLock } from "../../library/utils/distributedLock";
import { EventSourcingPipeline } from "../pipeline";
import type { QueueProcessorFactory } from "../queue";
import type {
  PipelineMetadata,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./types";

export interface PipelineBuilderOptions<EventType extends Event = Event> {
  eventStore: EventStore<EventType>;
  queueProcessorFactory?: QueueProcessorFactory;
  distributedLock?: DistributedLock;
  handlerLockTtlMs?: number;
  updateLockTtlMs?: number;
  commandLockTtlMs?: number;
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
   * Optional: Delay in milliseconds before processing the job.
   */
  delay?: number;

  /**
   * Optional: Deduplication configuration.
   * When set, jobs with the same deduplication ID will be deduplicated within the TTL window.
   */
  deduplication?: DeduplicationConfig<Payload>;

  /**
   * Optional: Concurrency limit for processing jobs.
   * Default: 5
   */
  concurrency?: number;

  /**
   * Optional: Function to extract span attributes from the payload.
   * Default: Uses static getSpanAttributes from handler class
   */
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;

  /**
   * Optional: Lock TTL in milliseconds for this command handler.
   * Default: Uses commandLockTtlMs from PipelineBuilderOptions, or 30000ms
   */
  lockTtlMs?: number;
}

/**
 * Builder for creating event sourcing pipelines with type-safe required fields.
 * Uses TypeScript type state machine pattern to enforce that all required fields
 * are provided before build() can be called.
 */
export class PipelineBuilder<EventType extends Event> {
  constructor(private readonly options: PipelineBuilderOptions<EventType>) {}

  withName(name: string): PipelineBuilderWithName<EventType> {
    return new PipelineBuilderWithName(this.options, name);
  }

  build(): never {
    throw new ConfigurationError(
      "PipelineBuilder",
      "Pipeline name is required",
    );
  }
}

export class PipelineBuilderWithName<EventType extends Event> {
  constructor(
    private readonly options: PipelineBuilderOptions<EventType>,
    private readonly name: string,
  ) {}

  withAggregateType(
    aggregateType: AggregateType,
  ): PipelineBuilderWithNameAndType<
    EventType,
    never,
    never,
    ProjectionTypeMap
  > {
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
  RegisteredHandlerNames extends string = never,
  RegisteredCommandHandlers extends RegisteredCommandHandler = never,
  RegisteredProjections extends ProjectionTypeMap = ProjectionTypeMap,
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
  private parentLinks: Array<ParentLink<EventType>> = [];

  constructor(
    private readonly options: PipelineBuilderOptions<EventType>,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
  ) {}

  /**
   * Register a projection handler class with a unique name.
   * The handler class must have a static `store` property.
   * This method can be called multiple times to register multiple projections.
   *
   * @param name - Unique name for this projection within the pipeline
   * @param handlerClass - Projection handler class to register (must have static `store` property)
   * @param options - Optional configuration for projection processing behavior (deduplication, batching)
   * @returns The same builder instance for method chaining
   * @throws Error if projection name already exists or if handler class doesn't have static store property
   *
   * @example
   * ```typescript
   * pipeline
   *   .withProjection("summary", SummaryProjectionHandler)
   *   .withProjection("analytics", AnalyticsProjectionHandler, {
   *     deduplication: {
   *       makeId: (event) => `${event.tenantId}:${event.aggregateType}:${event.aggregateId}`,
   *       ttlMs: 1000,
   *     },
   *   })
   * ```
   */
  withProjection<
    handlerClass extends ProjectionHandlerClass<EventType, any>,
    ProjectionName extends string,
  >(
    name: ProjectionName,
    handlerClass: handlerClass,
    options?: ProjectionOptions<EventType>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    RegisteredHandlerNames,
    RegisteredCommandHandlers,
    RegisteredProjections & {
      [K in ProjectionName]: ExtractProjectionHandlerProjection<handlerClass>;
    }
  > {
    if (this.projections.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Projection with name "${name}" already exists. Projection names must be unique within a pipeline.`,
        { projectionName: name },
      );
    }

    // Extract store from static property
    if (!handlerClass.store) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Projection handler class must have a static "store" property.`,
        { projectionName: name },
      );
    }

    // Instantiate handler
    const handler = new handlerClass();

    const projectionDef: ProjectionDefinition<
      EventType,
      ExtractProjectionHandlerProjection<handlerClass>
    > = {
      name,
      store: handlerClass.store,
      handler,
      options,
    };

    this.projections.set(name, projectionDef);

    return this as unknown as PipelineBuilderWithNameAndType<
      EventType,
      RegisteredHandlerNames,
      RegisteredCommandHandlers,
      RegisteredProjections & {
        [K in ProjectionName]: ExtractProjectionHandlerProjection<handlerClass>;
      }
    >;
  }

  /**
   * Register a parent link to another aggregate type.
   * This defines a many-to-one relationship from this aggregate to a parent.
   * The inverse (one-to-many children) relationship is automatically inferred.
   *
   * @param targetAggregateType - The aggregate type of the parent
   * @param extractParentId - Function to extract the parent aggregate ID from an event
   * @returns The same builder instance for method chaining
   *
   * @example
   * ```typescript
   * // Span has a parent Trace, linked via traceId
   * pipeline.withParentLink("trace", (e) => e.data.spanData.traceId)
   * ```
   */
  withParentLink(
    targetAggregateType: AggregateType,
    extractParentId: (event: EventType) => string | null,
  ): PipelineBuilderWithNameAndType<
    EventType,
    RegisteredHandlerNames,
    RegisteredCommandHandlers,
    RegisteredProjections
  > {
    this.parentLinks.push({
      targetAggregateType,
      extractParentId,
    });
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
    RegisteredHandlerNames,
    RegisteredCommandHandlers,
    RegisteredProjections
  > {
    this.eventPublisher = publisher;
    return this;
  }

  /**
   * Register an event handler class that reacts to individual events.
   * Handlers are dispatched asynchronously via queues after events are stored.
   *
   * @param name - Unique name for this handler within the pipeline
   * @param handlerClass - Event handler class to register
   * @param options - Options for configuring the handler (event types, idempotency, etc.)
   * @returns A new builder instance with the handler name added to the registered names type
   * @throws Error if handler name already exists
   *
   * @example
   * ```typescript
   * pipeline
   *   .withEventHandler("span-storage", SpanClickHouseHandler, {
   *     eventTypes: ["lw.obs.trace.span_received"],
   *   })
   *   .withEventHandler("trace-aggregator", TraceHandler)
   * ```
   */
  withEventHandler<
    handlerClass extends EventHandlerClass<EventType>,
    HandlerName extends string,
  >(
    name: HandlerName,
    handlerClass: handlerClass,
    options?: EventHandlerOptions<EventType, RegisteredHandlerNames>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    RegisteredHandlerNames | HandlerName,
    RegisteredCommandHandlers,
    RegisteredProjections
  > {
    if (this.eventHandlers.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Event handler with name "${name}" already exists. Handler names must be unique within a pipeline.`,
        { handlerName: name },
      );
    }

    // Instantiate handler
    const handler = new handlerClass();

    // Merge event types from static method and options (options take precedence)
    const mergedOptions: EventHandlerOptions<
      EventType,
      RegisteredHandlerNames
    > = {
      ...options,
      eventTypes:
        options?.eventTypes ?? handlerClass.getEventTypes?.() ?? void 0,
    };

    const handlerDef: EventHandlerDefinition<
      EventType,
      RegisteredHandlerNames
    > = {
      name,
      handler,
      options: mergedOptions,
    };

    this.eventHandlers.set(name, handlerDef);

    return this as PipelineBuilderWithNameAndType<
      EventType,
      RegisteredHandlerNames | HandlerName,
      RegisteredCommandHandlers,
      RegisteredProjections
    >;
  }

  /**
   * Register a self-contained command handler class.
   * The class bundles schema, handler implementation, and all configuration methods.
   *
   * @param name - Unique name for this command handler within the pipeline
   * @param handlerClass - The command handler class to register
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
    handlerClass extends CommandHandlerClass<any, any, EventType>,
    Name extends string,
  >(
    name: Name,
    handlerClass: handlerClass,
    options?: CommandHandlerOptions<ExtractCommandHandlerPayload<handlerClass>>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    RegisteredHandlerNames,
    | RegisteredCommandHandlers
    | {
        name: Name;
        payload: ExtractCommandHandlerPayload<handlerClass>;
      },
    RegisteredProjections
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
      HandlerClass: handlerClass,
      name,
      options,
    });

    return this as unknown as PipelineBuilderWithNameAndType<
      EventType,
      RegisteredHandlerNames,
      | RegisteredCommandHandlers
      | {
          name: Name;
          payload: ExtractCommandHandlerPayload<handlerClass>;
        },
      RegisteredProjections
    >;
  }

  build(): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, RegisteredProjections>,
    RegisteredCommandHandlers extends never
      ? Record<string, EventSourcedQueueProcessor<any>>
      : CommandHandlersToRecord<RegisteredCommandHandlers>
  > {
    // Convert projections map to object format
    // Use Array.from to convert Map entries to array so our type augmentation works
    // TypeScript can't infer the specific mapped type from Object.fromEntries,
    // but we know the runtime values match RegisteredProjections
    const projectionsObject:
      | ProjectionDefinitions<EventType, RegisteredProjections>
      | undefined =
      this.projections.size > 0
        ? (Object.fromEntries(
            Array.from(this.projections),
          ) as ProjectionDefinitions<EventType, RegisteredProjections>)
        : void 0;

    // Convert event handlers map to object format
    const eventHandlersObject =
      this.eventHandlers.size > 0
        ? Object.fromEntries(this.eventHandlers)
        : void 0;

    // Build metadata for tooling and introspection
    const metadata: PipelineMetadata = {
      name: this.name,
      aggregateType: this.aggregateType,
      projections: Array.from(this.projections.entries()).map(
        ([name, def]) => ({
          name,
          handlerClassName: def.handler.constructor.name,
        }),
      ),
      eventHandlers: Array.from(this.eventHandlers.entries()).map(
        ([name, def]) => ({
          name,
          handlerClassName: def.handler.constructor.name,
          eventTypes: [...(def.options?.eventTypes || [])],
        }),
      ),
      commands: this.commandHandlers.map((reg) => ({
        name: reg.name,
        handlerClassName: reg.HandlerClass.name,
      })),
    };

    const pipeline = new EventSourcingPipeline<
      EventType,
      RegisteredProjections
    >({
      name: this.name,
      aggregateType: this.aggregateType,
      eventStore: this.options.eventStore,
      projections: projectionsObject,
      eventPublisher: this.eventPublisher,
      eventHandlers: eventHandlersObject,
      queueProcessorFactory: this.options.queueProcessorFactory,
      distributedLock: this.options.distributedLock,
      handlerLockTtlMs: this.options.handlerLockTtlMs,
      updateLockTtlMs: this.options.updateLockTtlMs,
      commandLockTtlMs: this.options.commandLockTtlMs,
      processorCheckpointStore: this.options.processorCheckpointStore,
      parentLinks: this.parentLinks.length > 0 ? this.parentLinks : undefined,
      metadata,
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
    }) as PipelineWithCommandHandlers<
      RegisteredPipeline<EventType, RegisteredProjections>,
      RegisteredCommandHandlers extends never
        ? Record<string, EventSourcedQueueProcessor<any>>
        : CommandHandlersToRecord<RegisteredCommandHandlers>
    >;
  }
}
