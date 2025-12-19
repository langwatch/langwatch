import { createLogger } from "~/utils/logger";
import type { QueueProcessorFactory } from "../../../runtime/queue";
import type { Command, CommandHandler } from "../../commands/command";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import { EventSchema } from "../../domain/types";
import type { EventHandlerDefinitions } from "../../eventHandler.types";
import type { CommandSchemaType, CommandType } from "../../index";
import { createCommand, createTenantId, EventUtils } from "../../index";
import type { ProjectionDefinition } from "../../projection.types";
import type { EventSourcedQueueProcessor } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import { ConfigurationError, ValidationError } from "../errorHandling";
import type { FeatureFlagServiceInterface } from "../../../../featureFlag/types";
import type { DistributedLock } from "../../utils/distributedLock";

/**
 * Kill switch options for event sourcing components.
 * When the feature flag is true, the component is disabled.
 */
interface KillSwitchOptions {
  /** Optional custom feature flag key override */
  customKey?: string;
  /** Default value if feature flag service unavailable */
  defaultValue?: boolean;
}

/**
 * Configuration extracted from a command handler class, merged with options.
 */
interface HandlerConfig<Payload> {
  getAggregateId: (payload: Payload) => string;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  concurrency?: number;
  lockTtlMs?: number;
}

/**
 * Options for configuring a command handler.
 * This interface matches CommandHandlerOptions from the builder to avoid circular dependencies.
 */
interface CommandHandlerOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  concurrency?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  killSwitch?: KillSwitchOptions;
}

/**
 * Extracts configuration from a command handler class and merges with options.
 * Options take precedence over static methods.
 */
function extractHandlerConfig<Payload>(
  HandlerClass: {
    getAggregateId: (payload: Payload) => string;
    getSpanAttributes?: (
      payload: Payload,
    ) => Record<string, string | number | boolean>;
    makeJobId?: (payload: Payload) => string;
    delay?: number;
    concurrency?: number;
  },
  options?: CommandHandlerOptions<Payload>,
): HandlerConfig<Payload> {
  return {
    getAggregateId:
      options?.getAggregateId ?? HandlerClass.getAggregateId.bind(HandlerClass),
    makeJobId: options?.makeJobId ?? HandlerClass.makeJobId?.bind(HandlerClass),
    delay: options?.delay ?? HandlerClass.delay,
    spanAttributes:
      options?.spanAttributes ??
      HandlerClass.getSpanAttributes?.bind(HandlerClass),
    concurrency: options?.concurrency ?? HandlerClass.concurrency,
  };
}

/**
 * Generates a feature flag key for a component.
 * Pattern: es:{pipeline_name}:{component_type}:{component_name}:killswitch
 */
function generateFeatureFlagKey(
  aggregateType: AggregateType,
  componentType: "projection" | "eventHandler" | "command",
  componentName: string,
): string {
  return `es:${aggregateType}:${componentType}:${componentName}:killswitch`;
}

/**
 * Checks if a component is disabled via feature flag kill switch.
 * Returns true if the component should be disabled.
 */
async function isComponentDisabled(
  featureFlagService: FeatureFlagServiceInterface | undefined,
  aggregateType: AggregateType,
  componentType: "projection" | "eventHandler" | "command",
  componentName: string,
  tenantId: string,
  customKey?: string,
): Promise<boolean> {
  if (!featureFlagService) {
    return false; // No feature flag service, component is enabled
  }

  const flagKey =
    customKey ??
    generateFeatureFlagKey(aggregateType, componentType, componentName);

  try {
    const isDisabled = await featureFlagService.isEnabled(
      flagKey,
      tenantId,
      false,
    );
    if (isDisabled) {
      console.log(
        `[KILL_SWITCH] Component disabled via feature flag: ${componentType}:${componentName} for tenant ${tenantId}`,
      );
    }
    return isDisabled;
  } catch (error) {
    // Log error but don't fail - default to enabled
    console.warn(
      `[KILL_SWITCH] Error checking feature flag for ${componentType}:${componentName}:`,
      error,
    );
    return false;
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
  aggregateType: AggregateType,
  commandName: string,
  distributedLock?: DistributedLock,
  commandLockTtlMs: number = 30000,
  featureFlagService?: FeatureFlagServiceInterface,
  killSwitchOptions?: KillSwitchOptions,
): EventSourcedQueueProcessor<Payload> {
  const processor = factory.create<Payload>({
    name: queueName,
    makeJobId: config.makeJobId,
    delay: config.delay,
    spanAttributes: config.spanAttributes,
    options: config.concurrency ? { concurrency: config.concurrency } : void 0,
    async process(payload: Payload) {
      // Validate payload (also validated in send, but keep here for safety)
      const validation = commandSchema.validate(payload);
      if (!validation.success) {
        throw new ValidationError(
          `Invalid payload for command type "${commandType}". Validation failed.`,
          "payload",
          payload,
          { commandType, validationError: validation.error },
        );
      }

      const tenantId = createTenantId((payload as any).tenantId);
      const aggregateId = config.getAggregateId(payload);

      // Check kill switch - if enabled, skip command processing
      const isDisabled = await isComponentDisabled(
        featureFlagService,
        aggregateType,
        "command",
        commandName,
        tenantId,
        killSwitchOptions?.customKey,
      );
      if (isDisabled) {
        // Return early without processing
        return;
      }

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      // Handler returns events
      const events = await handler.handle(command);

      // Validate that handler returned events, not the payload
      if (!events) {
        throw new ValidationError(
          `Command handler for "${commandType}" returned undefined. Handler must return an array of events.`,
          "events",
          void 0,
          { commandType, payload },
        );
      }

      if (!Array.isArray(events)) {
        throw new ValidationError(
          `Command handler for "${commandType}" returned a non-array value. Handler must return an array of events, but got: ${typeof events}`,
          "events",
          events,
          { commandType, payload },
        );
      }

      // Validate each event structure before storing
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event) {
          throw new ValidationError(
            `Command handler for "${commandType}" returned an array with undefined at index ${i}. All events must be defined.`,
            "events",
            events,
            { commandType, payload, index: i },
          );
        }

        if (!EventUtils.isValidEvent(event)) {
          // Try to get more detailed validation error
          const parseResult = EventSchema.safeParse(event);
          const validationError =
            parseResult.success === false
              ? `Validation errors: ${parseResult.error.issues
                  .map(
                    (issue: any) => `${issue.path.join(".")}: ${issue.message}`,
                  )
                  .join(", ")}`
              : "Unknown validation error";

          throw new ValidationError(
            `Command handler for "${commandType}" returned an invalid event at index ${i}. Event must have id, aggregateId, timestamp, type, and data. ${validationError}. Got: ${JSON.stringify(event)}`,
            "events",
            event,
            {
              commandType,
              payload,
              index: i,
              validationErrors:
                parseResult.success === false
                  ? parseResult.error.issues
                  : void 0,
            },
          );
        }
      }

      // Store events automatically
      if (events.length > 0) {
        await storeEventsFn(events, { tenantId });
      }
    },
  });

  // Wrap the processor to validate payload synchronously before queuing
  return {
    async send(payload: Payload): Promise<void> {
      // Validate payload synchronously before queuing
      if (!commandSchema.validate(payload)) {
        throw new ValidationError(
          `Invalid payload for command type "${commandType}". Validation failed.`,
          "payload",
          payload,
          { commandType },
        );
      }
      // If validation passes, queue the job
      return processor.send(payload);
    },
    async close(): Promise<void> {
      return processor.close();
    },
  };
}

/**
 * Manages queue processors for event handlers, projections, and commands.
 * Handles initialization, lifecycle, and job ID generation.
 */
export class QueueProcessorManager<EventType extends Event = Event> {
  private readonly aggregateType: AggregateType;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:queue-processor-manager",
  );
  private readonly queueProcessorFactory?: QueueProcessorFactory;
  private readonly distributedLock?: DistributedLock;
  private readonly commandLockTtlMs: number;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  // Queue processors for event handlers (one per handler)
  private readonly handlerQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<EventType>
  >();
  // Queue processors for projections (one per projection)
  private readonly projectionQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<EventType>
  >();
  // Queue processors for commands (one per command handler)
  private readonly commandQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<any>
  >();

  constructor({
    aggregateType,
    queueProcessorFactory,
    distributedLock,
    commandLockTtlMs = 30000,
    featureFlagService,
  }: {
    aggregateType: AggregateType;
    queueProcessorFactory?: QueueProcessorFactory;
    distributedLock?: DistributedLock;
    commandLockTtlMs?: number;
    featureFlagService?: FeatureFlagServiceInterface;
  }) {
    this.aggregateType = aggregateType;
    this.queueProcessorFactory = queueProcessorFactory;
    this.distributedLock = distributedLock;
    this.commandLockTtlMs = commandLockTtlMs;
    this.featureFlagService = featureFlagService;
  }

  /**
   * Creates a default job ID for event handler processing.
   * Format: ${event.id}`
   */
  createDefaultJobId(event: EventType): string {
    return event.id;
  }

  /**
   * Initializes queue processors for all registered event handlers.
   * Each handler gets its own queue processor for async processing.
   *
   * @param eventHandlers - Map of handler definitions
   * @param handleEventCallback - Callback to process a single event through a handler
   */
  initializeHandlerQueues(
    eventHandlers: EventHandlerDefinitions<EventType>,
    handleEventCallback: (
      handlerName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    if (!this.queueProcessorFactory) {
      return;
    }

    // Process handlers in registration order
    const handlerNames = Object.keys(eventHandlers);

    for (const handlerName of handlerNames) {
      const handlerDef = eventHandlers[handlerName];
      if (!handlerDef) {
        continue;
      }

      const queueName = `${this.aggregateType}/handler/${handlerName}`;

      const queueProcessor = this.queueProcessorFactory.create<EventType>({
        name: queueName,
        makeJobId:
          handlerDef.options.makeJobId ?? this.createDefaultJobId.bind(this),
        delay: handlerDef.options.delay,
        options: handlerDef.options.concurrency
          ? { concurrency: handlerDef.options.concurrency }
          : void 0,
        spanAttributes: handlerDef.options.spanAttributes,
        process: async (event: EventType) => {
          await handleEventCallback(handlerName, event, {
            tenantId: event.tenantId,
          });
        },
      });

      this.handlerQueueProcessors.set(handlerName, queueProcessor);
    }
  }

  /**
   * Initializes queue processors for all registered projections.
   * Each projection gets its own queue processor for async processing.
   *
   * **Serial Processing**: Uses event ID as job ID to prevent deduplication (all events are queued).
   * The distributed lock in `updateProjectionByName` ensures serial processing per aggregate.
   * When lock acquisition fails, BullMQ will retry the job with backoff.
   *
   * @param projections - Map of projection definitions
   * @param processProjectionEventCallback - Callback to process a single event for a projection
   */
  initializeProjectionQueues(
    projections: Record<string, ProjectionDefinition<EventType, any>>,
    processProjectionEventCallback: (
      projectionName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    if (!this.queueProcessorFactory) {
      return;
    }

    for (const [projectionName] of Object.entries(projections)) {
      const queueName = `${this.aggregateType}/projection/${projectionName}`;

      // Use event ID directly as job ID - event IDs are unique, preventing deduplication
      // Distributed lock ensures serial processing per aggregate
      const makeProjectionJobId = (event: EventType): string => {
        this.logger.debug(
          {
            projectionName,
            eventId: event.id,
            tenantId: event.tenantId,
            aggregateId: String(event.aggregateId),
            eventType: event.type,
          },
          "Created projection job ID from event ID",
        );
        return event.id;
      };

      const queueProcessor = this.queueProcessorFactory.create<EventType>({
        name: queueName,
        makeJobId: makeProjectionJobId,
        spanAttributes: (event) => ({
          "projection.name": projectionName,
          "event.type": event.type,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
        }),
        process: async (event: EventType) => {
          await processProjectionEventCallback(projectionName, event, {
            tenantId: event.tenantId,
          });
        },
      });

      this.projectionQueueProcessors.set(projectionName, queueProcessor);
    }
  }

  /**
   * Gets the handler queue processor for a given handler name.
   */
  getHandlerQueueProcessor(
    handlerName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.handlerQueueProcessors.get(handlerName);
  }

  /**
   * Gets the projection queue processor for a given projection name.
   */
  getProjectionQueueProcessor(
    projectionName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.projectionQueueProcessors.get(projectionName);
  }

  /**
   * Gets all handler queue processors.
   */
  getHandlerQueueProcessors(): Map<
    string,
    EventSourcedQueueProcessor<EventType>
  > {
    return this.handlerQueueProcessors;
  }

  /**
   * Gets all projection queue processors.
   */
  getProjectionQueueProcessors(): Map<
    string,
    EventSourcedQueueProcessor<EventType>
  > {
    return this.projectionQueueProcessors;
  }

  /**
   * Initializes queue processors for all registered command handlers.
   * Each command handler gets its own queue processor for async processing.
   *
   * @param commandRegistrations - Array of command handler registrations
   * @param storeEventsFn - Callback to store events after command processing
   * @param pipelineName - Name of the pipeline (used for queue naming)
   */
  initializeCommandQueues<Payload>(
    commandRegistrations: Array<{
      name: string;
      HandlerClass: CommandHandlerClass<any, any, EventType>;
      options?: CommandHandlerOptions<Payload>;
    }>,
    storeEventsFn: (
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
    pipelineName: string,
  ): void {
    if (!this.queueProcessorFactory) {
      return;
    }

    for (const registration of commandRegistrations) {
      const HandlerClass = registration.HandlerClass;
      const schema = HandlerClass.schema;
      const commandType = schema.type;
      const handlerInstance = new HandlerClass();
      const config = extractHandlerConfig(HandlerClass, registration.options);

      // Use static dispatcherName if available, otherwise use the registration name
      const commandName = HandlerClass.dispatcherName ?? registration.name;

      // Validate uniqueness
      if (this.commandQueueProcessors.has(commandName)) {
        throw new ConfigurationError(
          "QueueProcessorManager",
          `Command handler with name "${commandName}" already exists. Command handler names must be unique within a pipeline.`,
          { commandName },
        );
      }

      // Create queue name
      const queueName = `${pipelineName}/command/${commandName}`;

      // Use per-command lockTtlMs if provided, otherwise use default
      const effectiveLockTtlMs = config.lockTtlMs ?? this.commandLockTtlMs;

      // Create and register dispatcher
      const dispatcher = createCommandDispatcher(
        commandType,
        schema,
        handlerInstance,
        config,
        queueName,
        storeEventsFn,
        this.queueProcessorFactory,
        this.aggregateType,
        commandName,
        this.distributedLock,
        effectiveLockTtlMs,
        this.featureFlagService,
        registration.options?.killSwitch,
      );

      this.commandQueueProcessors.set(commandName, dispatcher);
    }
  }

  /**
   * Gets the command queue processor for a given command name.
   */
  getCommandQueueProcessor<Payload>(
    commandName: string,
  ): EventSourcedQueueProcessor<Payload> | undefined {
    return this.commandQueueProcessors.get(commandName) as
      | EventSourcedQueueProcessor<Payload>
      | undefined;
  }

  /**
   * Gets all command queue processors.
   */
  getCommandQueueProcessors(): Map<string, EventSourcedQueueProcessor<any>> {
    return this.commandQueueProcessors;
  }

  /**
   * Gracefully closes all queue processors for event handlers, projections, and commands.
   * Should be called during application shutdown to ensure all queued jobs complete.
   */
  async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [
      handlerName,
      queueProcessor,
    ] of this.handlerQueueProcessors.entries()) {
      this.logger.debug(
        { handlerName },
        "Closing queue processor for event handler",
      );
      closePromises.push(queueProcessor.close());
    }

    for (const [
      projectionName,
      queueProcessor,
    ] of this.projectionQueueProcessors.entries()) {
      this.logger.debug(
        { projectionName },
        "Closing queue processor for projection",
      );
      closePromises.push(queueProcessor.close());
    }

    for (const [
      commandName,
      queueProcessor,
    ] of this.commandQueueProcessors.entries()) {
      this.logger.debug(
        { commandName },
        "Closing queue processor for command handler",
      );
      closePromises.push(queueProcessor.close());
    }

    await Promise.allSettled(closePromises);

    this.logger.debug(
      {
        handlerCount: this.handlerQueueProcessors.size,
        projectionCount: this.projectionQueueProcessors.size,
        commandCount: this.commandQueueProcessors.size,
      },
      "All queue processors closed",
    );
  }
}
