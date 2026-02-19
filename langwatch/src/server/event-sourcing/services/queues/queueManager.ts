import { makeQueueName } from "~/server/background/queues/makeQueueName";
import { createLogger } from "~/utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type {
  DeduplicationStrategy,
  EventSourcedQueueProcessor,
  QueueProcessorFactory,
} from "../../queues";
import { resolveDeduplicationStrategy } from "../../queues";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import type { KillSwitchOptions } from "../../pipeline/staticBuilder.types";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import {
  createCommandDispatcher,
  type CommandHandlerOptions,
} from "../commands/commandDispatcher";
import { ConfigurationError } from "../errorHandling";

const logger = createLogger("langwatch:event-sourcing:queue-manager");

/**
 * Manages queues for event handlers, projections, and commands.
 * Handles initialization, lifecycle, and job ID generation.
 */
export class QueueManager<EventType extends Event = Event> {
  private readonly aggregateType: AggregateType;
  private readonly pipelineName: string;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:queue-manager",
  );
  private readonly queueFactory?: QueueProcessorFactory;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly queues = new Map<
    string,
    EventSourcedQueueProcessor<any>
  >();
  private handlerCount = 0;
  private projectionCount = 0;
  private reactorCount = 0;

  constructor({
    aggregateType,
    pipelineName,
    queueFactory,
    featureFlagService,
  }: {
    aggregateType: AggregateType;
    pipelineName: string;
    queueFactory?: QueueProcessorFactory;
    featureFlagService?: FeatureFlagServiceInterface;
  }) {
    this.aggregateType = aggregateType;
    this.pipelineName = pipelineName;
    this.queueFactory = queueFactory;
    this.featureFlagService = featureFlagService;
  }

  private makePipelineQueueName(suffix: string): string {
    return makeQueueName(`${this.pipelineName}/${suffix}`);
  }

  private createDefaultDeduplicationId(event: EventType): string {
    return `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
  }

  private key(
    type: "handler" | "projection" | "command" | "reactor",
    name: string,
  ): string {
    return `${type}:${name}`;
  }

  initializeHandlerQueues(
    mapProjections: Record<string, {
      name: string;
      handler: { handle: (event: EventType) => Promise<void> };
      options: {
        eventTypes?: readonly string[];
        delay?: number;
        deduplication?: DeduplicationStrategy<EventType>;
        concurrency?: number;
        spanAttributes?: (event: EventType) => Record<string, string | number | boolean>;
        disabled?: boolean;
        killSwitch?: KillSwitchOptions;
      };
    }>,
    onEvent: (
      handlerName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    if (!this.queueFactory) {
      return;
    }

    const handlerNames = Object.keys(mapProjections);

    for (const handlerName of handlerNames) {
      const handlerDef = mapProjections[handlerName];
      if (!handlerDef) {
        continue;
      }

      const queueName = this.makePipelineQueueName(`handler/${handlerName}`);

      const queueProcessor = this.queueFactory.create<EventType>({
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
          await onEvent(handlerName, event, {
            tenantId: event.tenantId,
          });
        },
      });

      this.queues.set(this.key("handler", handlerName), queueProcessor);
      this.handlerCount++;
    }
  }

  initializeProjectionQueues(
    projections: Record<string, {
      name: string;
      groupKeyFn?: (event: EventType) => string;
      options?: {
        killSwitch?: KillSwitchOptions;
      };
    }>,
    onEvent: (
      projectionName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    if (!this.queueFactory) {
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

      const queueProcessor = this.queueFactory.create<EventType>({
        name: queueName,
        spanAttributes: (event) => ({
          "projection.name": projectionName,
          "event.type": event.type,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
        }),
        groupKey: projectionDef.groupKeyFn
          ? (event: EventType) => `${String(event.tenantId)}:${projectionDef.groupKeyFn!(event)}`
          : (event: EventType) => `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`,
        score: (event: EventType) => event.timestamp,
        process: async (event: EventType) => {
          await onEvent(projectionName, event, {
            tenantId: event.tenantId,
          });
        },
      });

      this.queues.set(
        this.key("projection", projectionName),
        queueProcessor,
      );
      this.projectionCount++;
    }
  }

  initializeCommandQueues<Payload extends Record<string, unknown>>(
    commandRegistrations: Array<{
      name: string;
      handlerClass: CommandHandlerClass<any, any, EventType>;
      options?: CommandHandlerOptions<Payload>;
    }>,
    storeEvents: (
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
    pipelineName: string,
  ): void {
    if (!this.queueFactory) {
      return;
    }

    for (const registration of commandRegistrations) {
      const handlerClass = registration.handlerClass;
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

      };

      const commandName = handlerClass.dispatcherName ?? registration.name;

      if (this.queues.has(this.key("command", commandName))) {
        throw new ConfigurationError(
          "QueueManager",
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
        storeEventsFn: storeEvents,
        factory: this.queueFactory,
        aggregateType: this.aggregateType,
        commandName,
        featureFlagService: this.featureFlagService,
        killSwitchOptions: registration.options?.killSwitch,
        logger,
      });

      this.queues.set(this.key("command", commandName), dispatcher);
    }
  }

  initializeReactorQueues(
    reactors: Record<string, {
      name: string;
      handler: { handle: (payload: { event: EventType; foldState: unknown }) => Promise<void> };
      options?: {
        killSwitch?: KillSwitchOptions;
        disabled?: boolean;
        delay?: number;
        deduplication?: DeduplicationStrategy<{ event: EventType; foldState: unknown }>;
      };
    }>,
    onEvent: (
      reactorName: string,
      payload: { event: EventType; foldState: unknown },
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    if (!this.queueFactory) {
      return;
    }

    for (const [reactorName, reactorDef] of Object.entries(reactors)) {
      const queueName = this.makePipelineQueueName(`reactor/${reactorName}`);

      const queueProcessor = this.queueFactory.create<{ event: EventType; foldState: unknown }>({
        name: queueName,
        delay: reactorDef.options?.delay,
        deduplication: reactorDef.options?.deduplication
          ? resolveDeduplicationStrategy(
              reactorDef.options.deduplication,
              (payload) => this.createDefaultDeduplicationId(payload.event),
            )
          : undefined,
        spanAttributes: (payload) => ({
          "reactor.name": reactorName,
          "event.type": payload.event.type,
          "event.id": payload.event.id,
          "event.aggregate_id": String(payload.event.aggregateId),
        }),
        process: async (payload: { event: EventType; foldState: unknown }) => {
          await onEvent(reactorName, payload, {
            tenantId: payload.event.tenantId,
          });
        },
      });

      this.queues.set(this.key("reactor", reactorName), queueProcessor);
      this.reactorCount++;
    }
  }

  hasHandlerQueues(): boolean {
    return this.handlerCount > 0;
  }

  hasProjectionQueues(): boolean {
    return this.projectionCount > 0;
  }

  hasReactorQueues(): boolean {
    return this.reactorCount > 0;
  }

  getHandlerQueue(
    handlerName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.queues.get(this.key("handler", handlerName)) as
      | EventSourcedQueueProcessor<EventType>
      | undefined;
  }

  getProjectionQueue(
    projectionName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.queues.get(this.key("projection", projectionName)) as
      | EventSourcedQueueProcessor<EventType>
      | undefined;
  }

  getReactorQueue(
    reactorName: string,
  ): EventSourcedQueueProcessor<{ event: EventType; foldState: unknown }> | undefined {
    return this.queues.get(this.key("reactor", reactorName)) as
      | EventSourcedQueueProcessor<{ event: EventType; foldState: unknown }>
      | undefined;
  }

  getCommandQueue<Payload extends Record<string, unknown>>(
    commandName: string,
  ): EventSourcedQueueProcessor<Payload> | undefined {
    return this.queues.get(this.key("command", commandName)) as
      | EventSourcedQueueProcessor<Payload>
      | undefined;
  }

  getCommandQueues(): Map<string, EventSourcedQueueProcessor<any>> {
    const result = new Map<string, EventSourcedQueueProcessor<any>>();
    const prefix = "command:";
    for (const [key, value] of this.queues) {
      if (key.startsWith(prefix)) {
        result.set(key.slice(prefix.length), value);
      }
    }
    return result;
  }

  async waitUntilReady(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map((q) => q.waitUntilReady()),
    );
    this.logger.debug({ queueCount: this.queues.size }, "All queues ready");
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.queues.values()].map((q) => q.close()),
    );
    this.logger.debug({ queueCount: this.queues.size }, "All queues closed");
  }
}
