import { createLogger } from "~/utils/logger/server";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { Command, CommandHandler } from "../../commands/command";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass";
import type { CommandSchema } from "../../commands/commandSchema";
import type { AggregateType } from "../../domain/aggregateType";
import type { CommandType } from "../../domain/commandType";
import type { Event } from "../../domain/types";
import type { KillSwitchOptions } from "../../pipeline/staticBuilder.types";
import type {
  DeduplicationConfig,
  DeduplicationStrategy,
  EventSourcedQueueProcessor,
  QueueSendOptions,
} from "../../queues";
import { resolveDeduplicationStrategy } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import {
  processCommand,
  type CommandHandlerOptions,
} from "../commands/commandDispatcher";
import { ConfigurationError, ValidationError } from "../errorHandling";

const logger = createLogger("langwatch:event-sourcing:queue-manager");

/**
 * Metadata stored per job type in the global job registry.
 * Used by the global queue's process/groupKey/score callbacks to dispatch to the right handler.
 */
export interface JobRegistryEntry {
  process: (payload: any) => Promise<void>;
  groupKeyFn: (payload: any) => string;
  scoreFn: (payload: any) => number;
  delay?: number;
  deduplication?: DeduplicationConfig<any>;
  spanAttributes?: (payload: any) => Record<string, string | number | boolean>;
}

/**
 * Manages queue facades for event handlers, projections, commands, and reactors.
 *
 * Creates per-job-type facades that inject routing metadata (__pipelineName, __jobType, __jobName)
 * into a global shared queue. The global queue and job registry are owned by EventSourcing
 * and shared across all pipelines.
 */
export class QueueManager<EventType extends Event = Event> {
  private readonly aggregateType: AggregateType;
  private readonly pipelineName: string;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:queue-manager",
  );
  private readonly globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  private readonly globalJobRegistry?: Map<string, JobRegistryEntry>;
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
    globalQueue,
    globalJobRegistry,
    featureFlagService,
  }: {
    aggregateType: AggregateType;
    pipelineName: string;
    globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
    globalJobRegistry?: Map<string, JobRegistryEntry>;
    featureFlagService?: FeatureFlagServiceInterface;
  }) {
    this.aggregateType = aggregateType;
    this.pipelineName = pipelineName;
    this.globalQueue = globalQueue;
    this.globalJobRegistry = globalJobRegistry;
    this.featureFlagService = featureFlagService;
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

  /**
   * Builds a globally unique registry key for this pipeline's job entry.
   */
  private registryKey(jobType: string, jobName: string): string {
    return `${this.pipelineName}:${jobType}:${jobName}`;
  }

  /**
   * Creates a facade that wraps the global queue, injecting __pipelineName/__jobType/__jobName
   * metadata on every send and namespacing dedup IDs.
   *
   * Registers the entry into the global job registry so the global queue's
   * process/groupKey/score callbacks can dispatch to the right handler.
   */
  private createFacade<P extends Record<string, unknown>>(
    jobType: string,
    jobName: string,
    entry: JobRegistryEntry,
  ): EventSourcedQueueProcessor<P> {
    if (!this.globalQueue || !this.globalJobRegistry) {
      throw new ConfigurationError(
        "QueueManager",
        "Cannot create facade without global queue and registry",
      );
    }

    const regKey = this.registryKey(jobType, jobName);
    this.globalJobRegistry.set(regKey, entry);

    const globalQueue = this.globalQueue;
    const pipelineName = this.pipelineName;

    // Namespace dedup IDs to avoid cross-pipeline/cross-type collisions
    const namespacedDedup: DeduplicationConfig<any> | undefined =
      entry.deduplication
        ? {
            ...entry.deduplication,
            makeId: (payload: any) => {
              const { __pipelineName: _p, __jobType: _t, __jobName: _n, ...clean } = payload;
              return `${pipelineName}/${jobType}/${jobName}/${entry.deduplication!.makeId(clean)}`;
            },
          }
        : undefined;

    const facade: EventSourcedQueueProcessor<P> = {
      send: async (payload: P, options?: QueueSendOptions<P>) => {
        await globalQueue.send(
          { ...payload, __pipelineName: pipelineName, __jobType: jobType, __jobName: jobName },
          {
            delay: options?.delay ?? entry.delay,
            deduplication:
              (options?.deduplication as DeduplicationConfig<any> | undefined) ??
              namespacedDedup,
          },
        );
      },
      sendBatch: async (payloads: P[], options?: QueueSendOptions<P>) => {
        await globalQueue.sendBatch(
          payloads.map((p) => ({
            ...p,
            __pipelineName: pipelineName,
            __jobType: jobType,
            __jobName: jobName,
          })),
          {
            delay: options?.delay ?? entry.delay,
            deduplication:
              (options?.deduplication as DeduplicationConfig<any> | undefined) ??
              namespacedDedup,
          },
        );
      },
      // Global queue lifecycle is owned by EventSourcing — facade close is a no-op
      close: async () => {},
      waitUntilReady: () => globalQueue.waitUntilReady(),
    };

    return facade;
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
    if (!this.globalQueue) {
      return;
    }

    const handlerNames = Object.keys(mapProjections);

    for (const handlerName of handlerNames) {
      const handlerDef = mapProjections[handlerName];
      if (!handlerDef) {
        continue;
      }

      const entry: JobRegistryEntry = {
        groupKeyFn: (event: any) =>
          `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`,
        scoreFn: (event: any) => event.timestamp,
        process: async (event: any) => {
          await onEvent(handlerName, event, {
            tenantId: event.tenantId,
          });
        },
        delay: handlerDef.options.delay,
        deduplication: resolveDeduplicationStrategy(
          handlerDef.options.deduplication,
          this.createDefaultDeduplicationId.bind(this),
        ),
        spanAttributes: handlerDef.options.spanAttributes,
      };

      const facade = this.createFacade<EventType>(
        "handler",
        handlerName,
        entry,
      );
      this.queues.set(this.key("handler", handlerName), facade);
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
    if (!this.globalQueue) {
      return;
    }

    for (const [projectionName] of Object.entries(projections)) {
      const projectionDef = projections[projectionName];
      if (!projectionDef) {
        continue;
      }

      const customGroupKeyFn = projectionDef.groupKeyFn;
      const entry: JobRegistryEntry = {
        groupKeyFn: customGroupKeyFn
          ? (event: any) =>
              `${String(event.tenantId)}:${customGroupKeyFn(event)}`
          : (event: any) =>
              `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`,
        scoreFn: (event: any) => event.timestamp,
        process: async (event: any) => {
          await onEvent(projectionName, event, {
            tenantId: event.tenantId,
          });
        },
        spanAttributes: (event: any) => ({
          "projection.name": projectionName,
          "event.type": event.type,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
        }),
      };

      const facade = this.createFacade<EventType>(
        "projection",
        projectionName,
        entry,
      );
      this.queues.set(this.key("projection", projectionName), facade);
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
    if (!this.globalQueue) {
      return;
    }

    // Step 1: Build handler registry
    interface CommandRegistryEntry {
      handler: CommandHandler<Command<any>, EventType>;
      schema: CommandSchema<any, CommandType>;
      getAggregateId: (payload: any) => string;
      options: CommandHandlerOptions<any>;
      commandName: string;
      commandType: CommandType;
      killSwitchOptions?: KillSwitchOptions;
      spanAttributes?: (
        payload: any,
      ) => Record<string, string | number | boolean>;
    }

    const commandRegistry = new Map<string, CommandRegistryEntry>();

    for (const registration of commandRegistrations) {
      const handlerClass = registration.handlerClass;
      const schema = handlerClass.schema;
      const commandType = schema.type;
      const handlerInstance = new handlerClass();

      const getAggregateId =
        registration.options?.getAggregateId ??
        handlerClass.getAggregateId.bind(handlerClass);

      const commandName = handlerClass.dispatcherName ?? registration.name;

      if (this.queues.has(this.key("command", commandName))) {
        throw new ConfigurationError(
          "QueueManager",
          `Command handler with name "${commandName}" already exists. Command handler names must be unique within a pipeline.`,
          { commandName },
        );
      }

      commandRegistry.set(commandName, {
        handler: handlerInstance,
        schema,
        getAggregateId,
        options: registration.options ?? {},
        commandName,
        commandType,
        killSwitchOptions: registration.options?.killSwitch,
        spanAttributes:
          registration.options?.spanAttributes ??
          handlerClass.getSpanAttributes?.bind(handlerClass),
      });
    }

    if (commandRegistry.size === 0) {
      return;
    }

    // Step 2: Register each command in the global queue and create facades
    for (const [cmdName, cmdEntry] of commandRegistry) {
      const rawDedup = resolveDeduplicationStrategy(
        cmdEntry.options.deduplication as
          | DeduplicationStrategy<any>
          | undefined,
        (payload: any) => {
          const aggregateId = cmdEntry.getAggregateId(payload);
          return `${String(payload.tenantId)}:${this.aggregateType}:${String(aggregateId)}`;
        },
      );

      const jobEntry: JobRegistryEntry = {
        groupKeyFn: (payload: any) => {
          const aggregateId = cmdEntry.getAggregateId(payload);
          return `${String(payload.tenantId)}:${this.aggregateType}:${String(aggregateId)}`;
        },
        scoreFn: (payload: any) => payload.occurredAt as number,
        process: async (payload: any) => {
          await processCommand({
            payload,
            commandType: cmdEntry.commandType,
            commandSchema: cmdEntry.schema,
            handler: cmdEntry.handler,
            getAggregateId: cmdEntry.getAggregateId,
            storeEventsFn: storeEvents,
            aggregateType: this.aggregateType,
            commandName: cmdEntry.commandName,
            featureFlagService: this.featureFlagService,
            killSwitchOptions: cmdEntry.killSwitchOptions,
            logger,
          });
        },
        delay: cmdEntry.options.delay,
        deduplication: rawDedup,
        spanAttributes: cmdEntry.spanAttributes,
      };

      const baseFacade = this.createFacade<Record<string, unknown>>(
        "command",
        cmdName,
        jobEntry,
      );

      // Wrap with pre-send validation
      const validatingFacade: EventSourcedQueueProcessor<any> = {
        send: async (payload: any, options?: QueueSendOptions<any>) => {
          const validation = cmdEntry.schema.validate(payload);
          if (!validation.success) {
            throw new ValidationError(
              `Invalid payload for command type "${cmdEntry.commandType}". Validation failed.`,
              "payload",
              undefined,
              {
                commandType: cmdEntry.commandType,
                zodIssues: mapZodIssuesToLogContext(
                  validation.error.issues,
                ),
              },
            );
          }
          return baseFacade.send(payload, options);
        },
        sendBatch: async (payloads: any[], options?: QueueSendOptions<any>) => {
          for (const payload of payloads) {
            const validation = cmdEntry.schema.validate(payload);
            if (!validation.success) {
              throw new ValidationError(
                `Invalid payload for command type "${cmdEntry.commandType}". Validation failed.`,
                "payload",
                undefined,
                {
                  commandType: cmdEntry.commandType,
                  zodIssues: mapZodIssuesToLogContext(
                    validation.error.issues,
                  ),
                },
              );
            }
          }
          return baseFacade.sendBatch(payloads, options);
        },
        close: baseFacade.close,
        waitUntilReady: baseFacade.waitUntilReady,
      };

      this.queues.set(this.key("command", cmdName), validatingFacade);
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
    if (!this.globalQueue) {
      return;
    }

    for (const [reactorName, reactorDef] of Object.entries(reactors)) {
      const entry: JobRegistryEntry = {
        groupKeyFn: (payload: any) =>
          `${String(payload.event.tenantId)}:${payload.event.aggregateType}:${String(payload.event.aggregateId)}`,
        scoreFn: (payload: any) => payload.event.timestamp,
        process: async (payload: any) => {
          await onEvent(reactorName, payload, {
            tenantId: payload.event.tenantId,
          });
        },
        delay: reactorDef.options?.delay,
        deduplication: reactorDef.options?.deduplication
          ? resolveDeduplicationStrategy(
              reactorDef.options.deduplication,
              (payload) => this.createDefaultDeduplicationId(payload.event),
            )
          : undefined,
        spanAttributes: (payload: any) => ({
          "reactor.name": reactorName,
          "event.type": payload.event.type,
          "event.id": payload.event.id,
          "event.aggregate_id": String(payload.event.aggregateId),
        }),
      };

      const facade = this.createFacade<{ event: EventType; foldState: unknown }>(
        "reactor",
        reactorName,
        entry,
      );
      this.queues.set(this.key("reactor", reactorName), facade);
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
    if (this.globalQueue) {
      await this.globalQueue.waitUntilReady();
    }
    this.logger.debug({ queueCount: this.queues.size }, "All queues ready");
  }

  async close(): Promise<void> {
    // Global queue lifecycle is owned by EventSourcing — facade close is a no-op.
    // We still call close on all facades for consistent behavior.
    await Promise.allSettled(
      [...this.queues.values()].map((q) => q.close()),
    );
    this.logger.debug({ queueCount: this.queues.size }, "All queues closed");
  }
}
