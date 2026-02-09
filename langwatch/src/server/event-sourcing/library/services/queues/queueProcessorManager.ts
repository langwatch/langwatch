import { createLogger } from "~/utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../../featureFlag/types";
import type { QueueProcessorFactory } from "../../../runtime/queue";
import type { Command, CommandHandler } from "../../commands/command";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass";
import type { AggregateType } from "../../domain/aggregateType";
import type { TenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSchema } from "../../domain/types";
import type { EventHandlerDefinitions } from "../../eventHandler.types";
import type {
  CommandSchemaType,
  CommandType,
  DeduplicationConfig,
  DeduplicationStrategy,
} from "../../index";
import { createCommand, createTenantId, EventUtils } from "../../index";

/**
 * Constraint interface for payloads that support command processing.
 * All command payloads must include a tenantId for tenant isolation.
 */
interface HasTenantId {
  tenantId: TenantId | string;
}
import type { ProjectionDefinition } from "../../projection.types";
import type { EventSourcedQueueProcessor } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import type { DistributedLock } from "../../utils/distributedLock";
import { ConfigurationError, ValidationError } from "../errorHandling";
import { mapZodIssuesToLogContext } from "~/utils/zod";

const logger = createLogger("langwatch:event-sourcing:queue-processor-manager");

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
 * Options for configuring a command handler.
 * This interface matches CommandHandlerOptions from the builder to avoid circular dependencies.
 */
interface CommandHandlerOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  delay?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  concurrency?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  killSwitch?: KillSwitchOptions;
  lockTtlMs?: number;
}

/**
 * Generates a feature flag key for a component.
 * Pattern: es-{pipeline_name}-{component_type}-{component_name}-killswitch
 */
function generateFeatureFlagKey(
  aggregateType: AggregateType,
  componentType: "projection" | "eventHandler" | "command",
  componentName: string,
): string {
  return `es-${aggregateType}-${componentType}-${componentName}-killswitch`;
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
      logger.debug(
        {
          componentType,
          componentName,
          tenantId,
        },
        "Component disabled via feature flag",
      );
    }
    return isDisabled;
  } catch (error) {
    // Log error but don't fail - default to enabled
    logger.warn(
      {
        componentType,
        componentName,
      },
      "Error checking feature flag",
      error,
    );
    return false;
  }
}

/**
 * Resolves a deduplication strategy to a concrete DeduplicationConfig or undefined.
 *
 * @param strategy - The deduplication strategy to resolve
 * @param createDefaultId - Function to create the default deduplication ID (for "aggregate" strategy)
 * @returns A DeduplicationConfig or undefined
 */
function resolveDeduplicationStrategy<Payload>(
  strategy: DeduplicationStrategy<Payload> | undefined,
  createDefaultId: (payload: Payload) => string,
): DeduplicationConfig<Payload> | undefined {
  if (strategy === undefined) {
    return undefined;
  }
  if (strategy === "aggregate") {
    return { makeId: createDefaultId };
  }
  // Custom DeduplicationConfig object
  return strategy;
}

/**
 * Creates a command dispatcher that processes commands and stores resulting events.
 */
function createCommandDispatcher<
  Payload extends HasTenantId,
  EventType extends Event,
>(
  commandType: CommandType,
  commandSchema: CommandSchemaType<Payload, CommandType>,
  handler: CommandHandler<Command<Payload>, EventType>,
  options: CommandHandlerOptions<Payload>,
  getAggregateId: (payload: Payload) => string,
  queueName: string,
  storeEventsFn: (
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ) => Promise<void>,
  factory: QueueProcessorFactory,
  aggregateType: AggregateType,
  commandName: string,
  _distributedLock?: DistributedLock,
  _commandLockTtlMs = 30000,
  featureFlagService?: FeatureFlagServiceInterface,
  killSwitchOptions?: KillSwitchOptions,
): EventSourcedQueueProcessor<Payload> {
  // Create default deduplication ID for commands based on aggregate
  const createDefaultCommandDeduplicationId = (payload: Payload): string => {
    const aggregateId = getAggregateId(payload);
    return `${String(payload.tenantId)}:${aggregateType}:${String(aggregateId)}`;
  };

  const processor = factory.create<Payload>({
    name: queueName,
    delay: options.delay,
    deduplication: resolveDeduplicationStrategy(
      options.deduplication,
      createDefaultCommandDeduplicationId,
    ),
    spanAttributes: options.spanAttributes,
    options: options.concurrency
      ? { concurrency: options.concurrency }
      : void 0,
    async process(payload: Payload) {
      // Validate payload (also validated in send, but keep here for safety)
      const validation = commandSchema.validate(payload);
      if (!validation.success) {
        throw new ValidationError(
          `Invalid payload for command type "${commandType}". Validation failed.`,
          "payload",
          undefined,
          {
            commandType,
            zodIssues: mapZodIssuesToLogContext(validation.error.issues),
          },
        );
      }

      const tenantId = createTenantId(String(payload.tenantId));
      const aggregateId = getAggregateId(payload);

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
          { commandType },
        );
      }

      if (!Array.isArray(events)) {
        throw new ValidationError(
          `Command handler for "${commandType}" returned a non-array value. Handler must return an array of events, but got: ${typeof events}`,
          "events",
          undefined,
          { commandType },
        );
      }

      // Validate each event structure before storing
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event) {
          throw new ValidationError(
            `Command handler for "${commandType}" returned an array with undefined at index ${i}. All events must be defined.`,
            "events",
            undefined,
            { commandType, index: i },
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
            `Command handler for "${commandType}" returned an invalid event at index ${i}. Event must have id, aggregateId, timestamp, type, and data. ${validationError}.`,
            "events",
            undefined,
            {
              commandType,
              index: i,
              zodIssues:
                parseResult.success === false
                  ? mapZodIssuesToLogContext(parseResult.error.issues)
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
      const validation = commandSchema.validate(payload);
      if (!validation.success) {
        throw new ValidationError(
          `Invalid payload for command type "${commandType}". Validation failed.`,
          "payload",
          undefined,
          {
            commandType,
            zodIssues: mapZodIssuesToLogContext(validation.error.issues),
          },
        );
      }
      // If validation passes, queue the job
      return processor.send(payload);
    },
    async close(): Promise<void> {
      return processor.close();
    },
    async waitUntilReady(): Promise<void> {
      return processor.waitUntilReady();
    },
  };
}

/**
 * Manages queue processors for event handlers, projections, and commands.
 * Handles initialization, lifecycle, and job ID generation.
 */
export class QueueProcessorManager<EventType extends Event = Event> {
  private readonly aggregateType: AggregateType;
  private readonly pipelineName: string;
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
    pipelineName,
    queueProcessorFactory,
    distributedLock,
    commandLockTtlMs = 30000,
    featureFlagService,
  }: {
    aggregateType: AggregateType;
    pipelineName: string;
    queueProcessorFactory?: QueueProcessorFactory;
    distributedLock?: DistributedLock;
    commandLockTtlMs?: number;
    featureFlagService?: FeatureFlagServiceInterface;
  }) {
    this.aggregateType = aggregateType;
    this.pipelineName = pipelineName;
    this.queueProcessorFactory = queueProcessorFactory;
    this.distributedLock = distributedLock;
    this.commandLockTtlMs = commandLockTtlMs;
    this.featureFlagService = featureFlagService;
  }

  /**
   * Wraps a queue suffix in a Redis Cluster hash tag.
   * Ensures all BullMQ keys for the queue land on the same Redis slot.
   */
  private makeQueueName(suffix: string): string {
    return `{${this.pipelineName}/${suffix}}`;
  }

  /**
   * Creates a default deduplication ID for event processing.
   * Format: ${event.tenantId}:${event.aggregateType}:${event.aggregateId}
   */
  private createDefaultDeduplicationId(event: EventType): string {
    return `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
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

      const queueName = this.makeQueueName(`handler/${handlerName}`);

      const queueProcessor = this.queueProcessorFactory.create<EventType>({
        name: queueName,
        delay: handlerDef.options.delay,
        deduplication: resolveDeduplicationStrategy(
          handlerDef.options.deduplication,
          this.createDefaultDeduplicationId.bind(this),
        ),
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
   * **Deduplication Strategy**: Uses custom deduplication config if provided in projection options,
   * otherwise defaults to `${tenantId}:${aggregateType}:${aggregateId}` for deduplication.
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
      const projectionDef = projections[projectionName];
      if (!projectionDef) {
        continue;
      }

      const queueName = this.makeQueueName(`projection/${projectionName}`);

      const queueProcessor = this.queueProcessorFactory.create<EventType>({
        name: queueName,
        delay: projectionDef.options?.delay,
        deduplication: resolveDeduplicationStrategy(
          projectionDef.options?.deduplication,
          this.createDefaultDeduplicationId.bind(this),
        ),
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
      const handlerClass = registration.HandlerClass;
      const schema = handlerClass.schema;
      const commandType = schema.type;
      const handlerInstance = new handlerClass();

      // Get aggregate ID extractor from options or handler class
      const getAggregateId =
        registration.options?.getAggregateId ??
        handlerClass.getAggregateId.bind(handlerClass);

      // Build options, merging registration options with handler class statics
      const options: CommandHandlerOptions<Payload> = {
        delay: registration.options?.delay,
        deduplication: registration.options?.deduplication,
        concurrency: registration.options?.concurrency,
        spanAttributes:
          registration.options?.spanAttributes ??
          handlerClass.getSpanAttributes?.bind(handlerClass),
        killSwitch: registration.options?.killSwitch,
        lockTtlMs: registration.options?.lockTtlMs,
      };

      // Use static dispatcherName if available, otherwise use the registration name
      const commandName = handlerClass.dispatcherName ?? registration.name;

      // Validate uniqueness
      if (this.commandQueueProcessors.has(commandName)) {
        throw new ConfigurationError(
          "QueueProcessorManager",
          `Command handler with name "${commandName}" already exists. Command handler names must be unique within a pipeline.`,
          { commandName },
        );
      }

      // Create queue name (uses this.pipelineName via makeQueueName)
      const queueName = this.makeQueueName(`command/${commandName}`);

      // Use per-command lockTtlMs if provided, otherwise use default
      const effectiveLockTtlMs = options.lockTtlMs ?? this.commandLockTtlMs;

      // Create and register dispatcher
      const dispatcher = createCommandDispatcher(
        commandType,
        schema,
        handlerInstance,
        options,
        getAggregateId,
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
   * Waits for all queue processors to be ready to accept jobs.
   * For BullMQ, this waits for workers to connect to Redis.
   * Should be called before sending commands in tests.
   */
  async waitUntilReady(): Promise<void> {
    const readyPromises: Promise<void>[] = [];

    for (const queueProcessor of this.handlerQueueProcessors.values()) {
      readyPromises.push(queueProcessor.waitUntilReady());
    }

    for (const queueProcessor of this.projectionQueueProcessors.values()) {
      readyPromises.push(queueProcessor.waitUntilReady());
    }

    for (const queueProcessor of this.commandQueueProcessors.values()) {
      readyPromises.push(queueProcessor.waitUntilReady());
    }

    await Promise.all(readyPromises);

    this.logger.debug(
      {
        handlerCount: this.handlerQueueProcessors.size,
        projectionCount: this.projectionQueueProcessors.size,
        commandCount: this.commandQueueProcessors.size,
      },
      "All queue processors ready",
    );
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
