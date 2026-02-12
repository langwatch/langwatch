import { makeQueueName } from "~/server/background/queues/makeQueueName";
import { createLogger } from "~/utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../../featureFlag/types";
import type { QueueProcessorFactory } from "../../../runtime/queue";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import type { EventHandlerDefinitions } from "../../eventHandler.types";
import type { ProjectionDefinition } from "../../projection.types";
import type { EventSourcedQueueProcessor } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import { ConfigurationError } from "../errorHandling";
import {
  createCommandDispatcher,
  resolveDeduplicationStrategy,
  type CommandHandlerOptions,
} from "./commandDispatcher";

const logger = createLogger("langwatch:event-sourcing:queue-processor-manager");

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
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly handlerQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<EventType>
  >();
  private readonly projectionQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<EventType>
  >();
  private readonly commandQueueProcessors = new Map<
    string,
    EventSourcedQueueProcessor<any>
  >();

  constructor({
    aggregateType,
    pipelineName,
    queueProcessorFactory,
    featureFlagService,
  }: {
    aggregateType: AggregateType;
    pipelineName: string;
    queueProcessorFactory?: QueueProcessorFactory;
    featureFlagService?: FeatureFlagServiceInterface;
  }) {
    this.aggregateType = aggregateType;
    this.pipelineName = pipelineName;
    this.queueProcessorFactory = queueProcessorFactory;
    this.featureFlagService = featureFlagService;
  }

  private makePipelineQueueName(suffix: string): string {
    return makeQueueName(`${this.pipelineName}/${suffix}`);
  }

  private createDefaultDeduplicationId(event: EventType): string {
    return `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
  }

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

    const handlerNames = Object.keys(eventHandlers);

    for (const handlerName of handlerNames) {
      const handlerDef = eventHandlers[handlerName];
      if (!handlerDef) {
        continue;
      }

      const queueName = this.makePipelineQueueName(`handler/${handlerName}`);

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

      const queueName = this.makePipelineQueueName(
        `projection/${projectionName}`,
      );

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
        groupKey: (event: EventType) =>
          `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`,
        process: async (event: EventType) => {
          await processProjectionEventCallback(projectionName, event, {
            tenantId: event.tenantId,
          });
        },
      });

      this.projectionQueueProcessors.set(projectionName, queueProcessor);
    }
  }

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

      const getAggregateId =
        registration.options?.getAggregateId ??
        handlerClass.getAggregateId.bind(handlerClass);

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

      const commandName = handlerClass.dispatcherName ?? registration.name;

      if (this.commandQueueProcessors.has(commandName)) {
        throw new ConfigurationError(
          "QueueProcessorManager",
          `Command handler with name "${commandName}" already exists. Command handler names must be unique within a pipeline.`,
          { commandName },
        );
      }

      const queueName = this.makePipelineQueueName(`command/${commandName}`);

      const dispatcher = createCommandDispatcher({
        commandType,
        commandSchema: schema,
        handler: handlerInstance,
        options,
        getAggregateId,
        queueName,
        storeEventsFn,
        factory: this.queueProcessorFactory,
        aggregateType: this.aggregateType,
        commandName,
        featureFlagService: this.featureFlagService,
        killSwitchOptions: registration.options?.killSwitch,
        logger,
      });

      this.commandQueueProcessors.set(commandName, dispatcher);
    }
  }

  getHandlerQueueProcessor(
    handlerName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.handlerQueueProcessors.get(handlerName);
  }

  getProjectionQueueProcessor(
    projectionName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.projectionQueueProcessors.get(projectionName);
  }

  getHandlerQueueProcessors(): Map<
    string,
    EventSourcedQueueProcessor<EventType>
  > {
    return this.handlerQueueProcessors;
  }

  getProjectionQueueProcessors(): Map<
    string,
    EventSourcedQueueProcessor<EventType>
  > {
    return this.projectionQueueProcessors;
  }

  getCommandQueueProcessor<Payload>(
    commandName: string,
  ): EventSourcedQueueProcessor<Payload> | undefined {
    return this.commandQueueProcessors.get(commandName) as
      | EventSourcedQueueProcessor<Payload>
      | undefined;
  }

  getCommandQueueProcessors(): Map<string, EventSourcedQueueProcessor<any>> {
    return this.commandQueueProcessors;
  }

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
