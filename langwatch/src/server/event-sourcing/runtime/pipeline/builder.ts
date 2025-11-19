import type {
  Event,
  Projection,
  EventStore,
  ProjectionStore,
  EventHandler,
  EventReactionHandler,
  AggregateType,
  CommandHandler,
  Command,
  CommandType,
  EventPublisher,
  CommandSchemaType,
  EventStoreReadContext,
  CommandHandlerClass,
  ExtractCommandHandlerPayload,
  ExtractCommandHandlerDispatcherName,
  EventSourcedQueueProcessor,
} from "../../library";
import type { ProjectionDefinition } from "../../library/projection.types";
import type {
  EventHandlerDefinition,
  EventHandlerOptions,
} from "../../library/eventHandler.types";
import { EventSourcingPipeline } from "../index";
import { defaultQueueProcessorFactory } from "../queue";
import type { RegisteredPipeline, PipelineWithCommandHandlers } from "./types";
import type { QueueProcessorFactory } from "../queue";
import { createCommand, createTenantId } from "../../library";

/**
 * Infers a dispatcher name from a command handler class.
 * First tries to use the static dispatcherName property, then falls back to
 * inferring from the class name.
 *
 * Examples:
 * - Class with `static readonly dispatcherName = "recordSpan"` → `recordSpan`
 * - `RecordSpanCommand` → `recordSpan`
 *
 * Strategy:
 * 1. Check for static dispatcherName property
 * 2. If not found, extract class name
 * 3. Remove "CommandHandler" or "Command" suffix
 * 4. Convert PascalCase to camelCase
 */
function inferDispatcherName(handler: CommandHandler<any, any>): string {
  const HandlerClass = handler.constructor as { dispatcherName?: string };

  // Use static dispatcherName if available
  if (HandlerClass.dispatcherName) {
    return HandlerClass.dispatcherName;
  }

  // Fall back to inferring from class name
  const className = handler.constructor.name;

  // Remove "CommandHandler" or "Command" suffix
  const withoutSuffix = className.replace(/Command(Handler)?$/, "");

  // Convert PascalCase to camelCase
  const camelCase =
    withoutSuffix.charAt(0).toLowerCase() + withoutSuffix.slice(1);

  return camelCase;
}

/**
 * Configuration extracted from a command handler class.
 */
interface HandlerConfig<Payload> {
  getAggregateId: (payload: Payload) => string;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  concurrency?: number;
}

/**
 * Extracts configuration from a command handler class.
 */
function extractHandlerConfig<Payload>(HandlerClass: {
  getAggregateId: (payload: Payload) => string;
  getSpanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  concurrency?: number;
}): HandlerConfig<Payload> {
  return {
    getAggregateId: HandlerClass.getAggregateId.bind(HandlerClass),
    makeJobId: HandlerClass.makeJobId?.bind(HandlerClass),
    delay: HandlerClass.delay,
    spanAttributes: HandlerClass.getSpanAttributes?.bind(HandlerClass),
    concurrency: HandlerClass.concurrency,
  };
}

/**
 * Validates that a dispatcher name is unique.
 */
function validateDispatcherName(
  dispatcherName: string,
  existingDispatchers: Record<string, EventSourcedQueueProcessor<unknown>>,
): void {
  if (existingDispatchers[dispatcherName]) {
    throw new Error(
      `Dispatcher with name "${dispatcherName}" already exists. Dispatcher names must be unique.`,
    );
  }
}

/**
 * Creates a command dispatcher that processes commands and stores resulting events.
 */
function createCommandDispatcher<Payload, EventType extends Event>(
  commandType: CommandType,
  commandSchema: CommandSchemaType<Payload, CommandType>,
  handler: CommandHandler<Command<Payload>, EventType>,
  config: HandlerConfig<Payload>,
  queueName: string,
  storeEventsFn: (
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ) => Promise<void>,
  factory: QueueProcessorFactory,
): EventSourcedQueueProcessor<Payload> {
  return factory.create<Payload>({
    name: queueName,
    makeJobId: config.makeJobId,
    delay: config.delay,
    spanAttributes: config.spanAttributes,
    options: config.concurrency ? { concurrency: config.concurrency } : void 0,
    async process(payload: Payload) {
      // Validate payload
      if (!commandSchema.validate(payload)) {
        throw new Error(
          `Invalid payload for command type "${commandType}". Validation failed.`,
        );
      }

      const tenantId = createTenantId((payload as any).tenantId);
      const aggregateId = config.getAggregateId(payload);

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      // Handler returns events
      const events = await handler.handle(command);

      // Store events automatically
      if (events && events.length > 0) {
        await storeEventsFn(events, { tenantId });
      }
    },
  });
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
 * 4. Optionally call `withProjection(name, store, handler)` multiple times to register projections
 * 5. Optionally call `withEventPublisher(publisher)` to register an event publisher
 * 6. Optionally call `withCommandHandler(...)` to register command handlers
 * 7. Call `build()` to create the `RegisteredPipeline`
 *
 * **Example:**
 * ```typescript
 * const pipeline = eventSourcing
 *   .registerPipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("trace")
 *   .withProjection("summary", summaryStore, summaryHandler)
 *   .withProjection("analytics", analyticsStore, analyticsHandler)
 *   .withEventPublisher(publisher)
 *   .withCommandHandler(...)
 *   .build();
 * ```
 */
export class PipelineBuilder<
  EventType extends Event,
  ProjectionType extends Projection,
> {
  constructor(
    private readonly eventStore: EventStore<any>,
    private readonly queueProcessorFactory: QueueProcessorFactory = defaultQueueProcessorFactory,
  ) {}

  withName(name: string): PipelineBuilderWithName<EventType, ProjectionType> {
    return new PipelineBuilderWithName(
      this.eventStore,
      name,
      this.queueProcessorFactory,
    );
  }

  build(): never {
    throw new Error("Pipeline name is required");
  }
}

export class PipelineBuilderWithName<
  EventType extends Event,
  ProjectionType extends Projection,
> {
  constructor(
    private readonly eventStore: EventStore<any>,
    private readonly name: string,
    private readonly queueProcessorFactory: QueueProcessorFactory = defaultQueueProcessorFactory,
  ) {}

  withAggregateType(
    aggregateType: AggregateType,
  ): PipelineBuilderWithNameAndType<EventType, ProjectionType, never, never> {
    return new PipelineBuilderWithNameAndType(
      this.eventStore,
      this.name,
      aggregateType,
      this.queueProcessorFactory,
    );
  }

  build(): never {
    throw new Error("Aggregate type is required");
  }
}

interface CommandHandlerRegistration<EventType extends Event = Event> {
  HandlerClass: CommandHandlerClass<any, any, EventType>;
  dispatcherName?: string;
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
  private dispatchers: Record<string, EventSourcedQueueProcessor<unknown>> = {};

  constructor(
    private readonly eventStore: EventStore<any>,
    private readonly name: string,
    private readonly aggregateType: AggregateType,
    private readonly queueProcessorFactory: QueueProcessorFactory = defaultQueueProcessorFactory,
  ) {}

  /**
   * Register a projection with a unique name, store, and handler.
   * This method can be called multiple times to register multiple projections.
   *
   * @param name - Unique name for this projection within the pipeline
   * @param store - Store for persisting this projection
   * @param handler - Handler that processes events to build this projection
   * @returns The same builder instance for method chaining
   * @throws Error if projection name already exists
   *
   * @example
   * ```typescript
   * pipeline
   *   .withProjection("summary", summaryStore, summaryHandler)
   *   .withProjection("analytics", analyticsStore, analyticsHandler)
   * ```
   */
  withProjection<
    ProjectionName extends string,
    ProjType extends Projection = Projection,
  >(
    name: ProjectionName,
    store: ProjectionStore<ProjType>,
    handler: EventHandler<EventType, ProjType>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames,
    RegisteredCommandHandlers
  > {
    if (this.projections.has(name)) {
      throw new Error(
        `Projection with name "${name}" already exists. Projection names must be unique within a pipeline.`,
      );
    }

    this.projections.set(name, {
      name,
      store,
      handler,
    } as ProjectionDefinition<EventType, ProjType>);

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
   * Register an event handler that reacts to individual events.
   * Handlers are dispatched asynchronously via queues after events are stored.
   *
   * The `dependsOn` option is type-safe and only accepts handler names that have been
   * registered before this handler, providing compile-time safety for handler dependencies.
   *
   * @param name - Unique name for this handler within the pipeline
   * @param handler - Handler that processes individual events
   * @param options - Options for configuring the handler (event types, idempotency, etc.)
   * @returns A new builder instance with the handler name added to the registered names type
   * @throws Error if handler name already exists
   *
   * @example
   * ```typescript
   * pipeline
   *   .withEventHandler("span-storage", clickHouseHandler, {
   *     eventTypes: ["lw.obs.span_ingestion.recorded"],
   *   })
   *   .withEventHandler("trace-aggregator", traceHandler, {
   *     dependsOn: ["span-storage"], // Type-safe! Only accepts "span-storage"
   *   })
   * ```
   */
  withEventHandler<HandlerName extends string>(
    name: HandlerName,
    handler: EventReactionHandler<EventType>,
    options?: EventHandlerOptions<EventType, RegisteredHandlerNames>,
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames | HandlerName,
    RegisteredCommandHandlers
  > {
    if (this.eventHandlers.has(name)) {
      throw new Error(
        `Event handler with name "${name}" already exists. Handler names must be unique within a pipeline.`,
      );
    }

    this.eventHandlers.set(name, {
      name,
      handler,
      options: options ?? {},
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
   * @param HandlerClass - The command handler class to register (must have a static dispatcherName property)
   * @param options - Optional configuration, including custom dispatcher name (overrides static property)
   * @returns A new builder instance with the command handler tracked in the type system
   *
   * @example
   * ```typescript
   * pipeline.withCommandHandler(RecordSpanCommand);
   * pipeline.withCommandHandler(RecordSpanCommand, { dispatcherName: "custom-name" });
   * ```
   */
  withCommandHandler<
    HandlerClass extends CommandHandlerClass<any, any, EventType>,
    DispatcherName extends
      string = ExtractCommandHandlerDispatcherName<HandlerClass>,
  >(
    HandlerClass: HandlerClass,
    options?: {
      dispatcherName?: DispatcherName;
    },
  ): PipelineBuilderWithNameAndType<
    EventType,
    ProjectionType,
    RegisteredHandlerNames,
    | RegisteredCommandHandlers
    | {
        name: DispatcherName;
        payload: ExtractCommandHandlerPayload<HandlerClass>;
      }
  > {
    this.commandHandlers.push({
      HandlerClass,
      dispatcherName: options?.dispatcherName,
    });

    return this as PipelineBuilderWithNameAndType<
      EventType,
      ProjectionType,
      RegisteredHandlerNames,
      | RegisteredCommandHandlers
      | {
          name: DispatcherName;
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
      eventStore: this.eventStore as EventStore<EventType>,
      projections: projectionsObject,
      eventPublisher: this.eventPublisher,
      eventHandlers: eventHandlersObject,
      queueProcessorFactory: this.queueProcessorFactory,
    });

    // Create dispatchers now that we have the service
    // The service's storeEvents method will handle storing events and dispatching to handlers
    const storeEventsFn = async (
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => {
      await pipeline.service.storeEvents(events, context);
    };

    // Create dispatchers from registered handler classes
    for (const registration of this.commandHandlers) {
      const HandlerClass = registration.HandlerClass;
      const schema = HandlerClass.schema;
      const commandType = schema.type;
      const handlerInstance = new HandlerClass();
      const config = extractHandlerConfig(HandlerClass);

      // Use provided dispatcher name, or static property, or infer from class name
      const dispatcherName =
        registration.dispatcherName ?? inferDispatcherName(handlerInstance);

      // Validate uniqueness
      validateDispatcherName(dispatcherName, this.dispatchers);

      // Create queue name
      const queueName = `${this.name}_${dispatcherName}`;

      // Create and register dispatcher
      const dispatcher = createCommandDispatcher(
        commandType,
        schema,
        handlerInstance,
        config,
        queueName,
        storeEventsFn,
        this.queueProcessorFactory,
      );

      this.dispatchers[dispatcherName] = dispatcher;
    }

    // Attach dispatchers under a `commands` property
    // Type assertion is safe because we track the command handlers in the type system
    // and create dispatchers that match those types at runtime
    return Object.assign(pipeline, {
      commands: this.dispatchers,
    }) as unknown as PipelineWithCommandHandlers<
      RegisteredPipeline<EventType, ProjectionType>,
      RegisteredCommandHandlers extends never
        ? Record<string, EventSourcedQueueProcessor<any>>
        : CommandHandlersToRecord<RegisteredCommandHandlers>
    >;
  }
}
