import { createLogger } from "@langwatch/observability";
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
import type { JobDelivery } from "../../queues/queue.types";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import {
  type CommandHandlerOptions,
  processCommand,
  processCommandBatch,
} from "../commands/commandDispatcher";
import { ConfigurationError, ValidationError } from "../errorHandling";

const logger = createLogger("langwatch:event-sourcing:queue-manager");

/**
 * Minimum shape every standalone job payload must satisfy.
 *
 * `tenantId` is load-bearing rather than decorative: the group key, the score
 * and the default dedup id are all derived from it, so a payload without one
 * would funnel every job of that type into a single `undefined/job/<name>`
 * group and silently serialize the whole tenant fleet behind it.
 */
export type StandaloneJobPayload = { tenantId: string } & Record<
  string,
  unknown
>;

/**
 * Metadata stored per job type in the global job registry.
 * Used by the global queue's process/groupKey/score callbacks to dispatch to the right handler.
 *
 * The registry itself is heterogeneous (one map, many payload shapes), so the
 * parameter defaults to `any` for storage; `registerJob` instantiates it with
 * the concrete payload so the callbacks it builds stay type-checked.
 */
export interface JobRegistryEntry<Payload = any> {
  process: (payload: Payload, delivery?: JobDelivery) => Promise<void>;
  groupKeyFn: (payload: Payload) => string;
  scoreFn: (payload: Payload) => number;
  delay?: number;
  deduplication?: DeduplicationConfig<Payload>;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  /**
   * Optional batch processor for group coalescing. When set together with
   * `coalesceMaxBatch > 1`, the global queue may fold several same-group jobs
   * into one call (the dispatched job plus drained siblings, in occurredAt
   * order). The first payload is always the dispatched job.
   */
  processBatch?: (payloads: Payload[], delivery?: JobDelivery) => Promise<void>;
  /**
   * Max number of same-group jobs to coalesce into one `processBatch` call
   * (including the dispatched job). Defaults to 1 (no coalescing).
   */
  coalesceMaxBatch?: number;
  /**
   * Optional byte cap for a coalesced batch (ADR-066 pillar 2). Resolved by the
   * global queue per job; undefined falls back to the GroupQueue default.
   */
  coalesceMaxBytes?: number;
}

interface QueuedEventConsumerDefinition<E extends Event> {
  name: string;
  handler: { handle: (event: E) => Promise<void> };
  options: {
    eventTypes?: readonly string[];
    delay?: number;
    deduplication?: DeduplicationStrategy<E>;
    concurrency?: number;
    spanAttributes?: (event: E) => Record<string, string | number | boolean>;
    disabled?: boolean;
    killSwitch?: KillSwitchOptions;
    groupKeyFn?: (event: E) => string;
    coalesceMaxBatch?: number;
  };
}

/**
 * Manages queue facades for event handlers, projections, and commands.
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
  private readonly globalQueue?: EventSourcedQueueProcessor<
    Record<string, unknown>
  >;
  private readonly globalJobRegistry?: Map<string, JobRegistryEntry>;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly queues = new Map<string, EventSourcedQueueProcessor<any>>();
  private handlerCount = 0;
  private subscriberCount = 0;
  private stateProjectionCount = 0;
  private projectionCount = 0;

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

  /**
   * Builds a hierarchical group key function: `${tenantId}/${jobPath}/${domainKey}`.
   *
   * - jobPath reflects the pipeline topology (e.g. `fold/traceSummary`)
   * - domainKey defaults to `${aggregateType}:${aggregateId}`, overridable via custom fn
   */
  private buildGroupKey({
    jobPath,
    getTenantId,
    domainKeyFn,
  }: {
    jobPath: string;
    getTenantId: (payload: any) => string;
    domainKeyFn: (payload: any) => string;
  }): (payload: any) => string {
    return (payload: any) =>
      `${getTenantId(payload)}/${jobPath}/${domainKeyFn(payload)}`;
  }

  private key(
    type:
      | "handler"
      | "subscriber"
      | "stateProjection"
      | "projection"
      | "command"
      | "job",
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

    const stripInternal = (payload: any) => {
      const {
        __pipelineName: _p,
        __jobType: _t,
        __jobName: _n,
        ...clean
      } = payload;
      return clean;
    };

    // Namespace dedup IDs to avoid cross-pipeline/cross-type collisions
    const namespaceDedup = (
      dedup: DeduplicationConfig<any>,
    ): DeduplicationConfig<any> => ({
      ...dedup,
      makeId: (payload: any) =>
        `${pipelineName}/${jobType}/${jobName}/${dedup.makeId(stripInternal(payload))}`,
    });

    const namespacedEntryDedup: DeduplicationConfig<any> | undefined =
      entry.deduplication ? namespaceDedup(entry.deduplication) : undefined;

    const facade: EventSourcedQueueProcessor<P> = {
      send: async (payload: P, options?: QueueSendOptions<P>) => {
        const effectiveDedup = options?.deduplication
          ? namespaceDedup(options.deduplication as DeduplicationConfig<any>)
          : namespacedEntryDedup;

        await globalQueue.send(
          {
            ...payload,
            __pipelineName: pipelineName,
            __jobType: jobType,
            __jobName: jobName,
          },
          {
            delay: options?.delay ?? entry.delay,
            deduplication: effectiveDedup,
          },
        );
      },
      sendBatch: async (payloads: P[], options?: QueueSendOptions<P>) => {
        const effectiveDedup = options?.deduplication
          ? namespaceDedup(options.deduplication as DeduplicationConfig<any>)
          : namespacedEntryDedup;

        await globalQueue.sendBatch(
          payloads.map((p) => ({
            ...p,
            __pipelineName: pipelineName,
            __jobType: jobType,
            __jobName: jobName,
          })),
          {
            delay: options?.delay ?? entry.delay,
            deduplication: effectiveDedup,
          },
        );
      },
      // Global queue lifecycle is owned by EventSourcing — facade close is a no-op
      close: async () => undefined,
      waitUntilReady: () => globalQueue.waitUntilReady(),
    };

    return facade;
  }

  initializeHandlerQueues(
    mapProjections: Record<string, QueuedEventConsumerDefinition<EventType>>,
    onEvent: (
      handlerName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
    onEventBatch?: (
      handlerName: string,
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    this.initializeEventConsumerQueues({
      definitions: mapProjections,
      onEvent,
      onEventBatch,
      jobType: "handler",
      jobPath: "map",
      incrementCount: () => this.handlerCount++,
    });
  }

  initializeSubscriberQueues(
    subscribers: Record<string, QueuedEventConsumerDefinition<EventType>>,
    onEvent: (
      subscriberName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    this.initializeEventConsumerQueues({
      definitions: subscribers,
      onEvent,
      jobType: "subscriber",
      jobPath: "subscriber",
      incrementCount: () => this.subscriberCount++,
    });
  }

  private initializeEventConsumerQueues({
    definitions,
    onEvent,
    onEventBatch,
    jobType,
    jobPath,
    incrementCount,
  }: {
    definitions: Record<string, QueuedEventConsumerDefinition<EventType>>;
    onEvent: (
      consumerName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>;
    onEventBatch?: (
      consumerName: string,
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>;
    jobType: "handler" | "subscriber";
    jobPath: "map" | "subscriber";
    incrementCount: () => void;
  }): void {
    if (!this.globalQueue) return;

    for (const handlerName of Object.keys(definitions)) {
      const handlerDef = definitions[handlerName];
      if (!handlerDef) {
        continue;
      }

      const customGroupKeyFn = handlerDef.options.groupKeyFn;
      const groupKeyFn = this.buildGroupKey({
        jobPath: `${jobPath}/${handlerName}`,
        getTenantId: (event: any) => String(event.tenantId),
        domainKeyFn: customGroupKeyFn
          ? (event: any) => customGroupKeyFn(event)
          : (event: any) =>
              `${event.aggregateType}:${String(event.aggregateId)}`,
      });
      const entry: JobRegistryEntry = {
        groupKeyFn,
        scoreFn: (event: any) => event.occurredAt ?? event.createdAt,
        process: async (event: any) => {
          await onEvent(handlerName, event, {
            tenantId: event.tenantId,
          });
        },
        processBatch:
          onEventBatch &&
          handlerDef.options.coalesceMaxBatch &&
          handlerDef.options.coalesceMaxBatch > 1
            ? async (events: any[]) => {
                await onEventBatch(handlerName, events, {
                  tenantId: events[0]?.tenantId,
                });
              }
            : undefined,
        coalesceMaxBatch: handlerDef.options.coalesceMaxBatch,
        delay: handlerDef.options.delay,
        deduplication: resolveDeduplicationStrategy(
          handlerDef.options.deduplication,
          customGroupKeyFn
            ? (event: EventType) =>
                `${String(event.tenantId)}:${customGroupKeyFn(event)}`
            : this.createDefaultDeduplicationId.bind(this),
        ),
        spanAttributes: handlerDef.options.spanAttributes,
      };

      const facade = this.createFacade<EventType>(jobType, handlerName, entry);
      this.queues.set(this.key(jobType, handlerName), facade);
      incrementCount();
    }
  }

  initializeProjectionQueues(
    projections: Record<
      string,
      {
        name: string;
        groupKeyFn?: (event: EventType) => string;
        scoreFn?: (event: EventType) => number;
        coalesceMaxBatch?: number;
        options?: {
          killSwitch?: KillSwitchOptions;
        };
      }
    >,
    onEvent: (
      projectionName: string,
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
    onEventBatch?: (
      projectionName: string,
      events: EventType[],
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
    lane: {
      queueType: "projection" | "stateProjection";
      jobPath: "fold" | "state";
    } = { queueType: "projection", jobPath: "fold" },
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
      const groupKeyFn = this.buildGroupKey({
        jobPath: `${lane.jobPath}/${projectionName}`,
        getTenantId: (event: any) => String(event.tenantId),
        domainKeyFn: customGroupKeyFn
          ? (event: any) => customGroupKeyFn(event)
          : (event: any) =>
              `${event.aggregateType}:${String(event.aggregateId)}`,
      });
      const coalesceMaxBatch = projectionDef.coalesceMaxBatch;
      const entry: JobRegistryEntry = {
        groupKeyFn,
        scoreFn:
          projectionDef.scoreFn ??
          ((event: any) => event.occurredAt ?? event.createdAt),
        process: async (event: any, delivery?: JobDelivery) => {
          await onEvent(projectionName, event, {
            tenantId: event.tenantId,
            deliveryAttempt: delivery?.attempt,
          });
        },
        // Same-group fold events are coalesced into one load/apply/store cycle.
        // All events in a batch share the group (= same projection + aggregate),
        // so the tenant is taken from the first event.
        processBatch:
          onEventBatch && coalesceMaxBatch && coalesceMaxBatch > 1
            ? async (events: any[], delivery?: JobDelivery) => {
                await onEventBatch(projectionName, events, {
                  tenantId: events[0]?.tenantId,
                  deliveryAttempt: delivery?.attempt,
                });
              }
            : undefined,
        coalesceMaxBatch,
        spanAttributes: (event: any) => ({
          "projection.name": projectionName,
          "event.type": event.type,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
        }),
      };

      const facade = this.createFacade<EventType>(
        lane.queueType,
        projectionName,
        entry,
      );
      this.queues.set(this.key(lane.queueType, projectionName), facade);
      if (lane.queueType === "stateProjection") {
        this.stateProjectionCount++;
      } else {
        this.projectionCount++;
      }
    }
  }

  initializeStateProjectionQueues(
    projections: Parameters<
      QueueManager<EventType>["initializeProjectionQueues"]
    >[0],
    onEvent: Parameters<
      QueueManager<EventType>["initializeProjectionQueues"]
    >[1],
    onEventBatch?: Parameters<
      QueueManager<EventType>["initializeProjectionQueues"]
    >[2],
  ): void {
    this.initializeProjectionQueues(projections, onEvent, onEventBatch, {
      queueType: "stateProjection",
      jobPath: "state",
    });
  }

  initializeCommandQueues<Payload extends Record<string, unknown>>(
    commandRegistrations: Array<{
      name: string;
      handlerClass: CommandHandlerClass<any, any, EventType>;
      /** Pre-constructed instance — when provided, used instead of `new handlerClass()`. */
      handlerInstance?: CommandHandler<any, EventType>;
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
      getGroupKey?: (payload: any) => string;
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
      const handlerInstance =
        registration.handlerInstance ?? new handlerClass();

      const getAggregateId =
        registration.options?.getAggregateId ??
        handlerClass.getAggregateId.bind(handlerClass);

      const getGroupKey =
        registration.options?.getGroupKey ??
        handlerClass.getGroupKey?.bind(handlerClass);

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
        getGroupKey,
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
          const key = cmdEntry.getGroupKey
            ? cmdEntry.getGroupKey(payload)
            : cmdEntry.getAggregateId(payload);
          return `${String(payload.tenantId)}:${this.aggregateType}:${String(key)}`;
        },
      );

      const commandGroupKeyFn = this.buildGroupKey({
        jobPath: cmdEntry.options.serializeByAggregate
          ? "command"
          : `command/${cmdName}`,
        getTenantId: (payload: any) => String(payload.tenantId),
        domainKeyFn: (payload: any) => {
          const key = cmdEntry.options.serializeByAggregate
            ? cmdEntry.getAggregateId(payload)
            : cmdEntry.getGroupKey
              ? cmdEntry.getGroupKey(payload)
              : cmdEntry.getAggregateId(payload);
          return `${this.aggregateType}:${String(key)}`;
        },
      });
      const coalesceMaxBatch = cmdEntry.options.coalesceMaxBatch;

      // ADR-066 pillar 2 visibility: a serialized producer that does NOT
      // coalesce can still flood the event log one tiny insert per item under
      // high fan-in. Record the gap at registration so it can be found and
      // closed, instead of surfacing only as ClickHouse small-parts pressure.
      if (
        cmdEntry.options.serializeByAggregate &&
        !(coalesceMaxBatch && coalesceMaxBatch > 1)
      ) {
        this.logger.info(
          { pipeline: this.pipelineName, command: cmdName },
          "serialized command producer registered without append coalescing",
        );
      }

      // Shared across the single and batched processors — same command, same
      // store, same kill switch; only the payload arity differs.
      const commandProcessParams = {
        commandType: cmdEntry.commandType,
        commandSchema: cmdEntry.schema,
        handler: cmdEntry.handler,
        getAggregateId: cmdEntry.getAggregateId,
        storeEventsFn: storeEvents,
        aggregateType: this.aggregateType,
        commandName: cmdEntry.commandName,
        pipelineName: this.pipelineName,
        featureFlagService: this.featureFlagService,
        killSwitchOptions: cmdEntry.killSwitchOptions,
        logger,
      };

      const jobEntry: JobRegistryEntry = {
        groupKeyFn: commandGroupKeyFn,
        scoreFn: cmdEntry.options.serializeByAggregate
          ? () => Date.now()
          : (payload: any) => payload.occurredAt as number,
        process: async (payload: any) => {
          await processCommand({ ...commandProcessParams, payload });
        },
        // ADR-066 pillar 2: when the command opts into coalescing, fold a hot
        // aggregate's queued same-command jobs into one multi-row insert. The
        // GroupQueue only drains same-`__jobName` siblings, so every payload
        // here is this command type. Left undefined otherwise (per-job path).
        processBatch:
          coalesceMaxBatch && coalesceMaxBatch > 1
            ? async (payloads: any[]) => {
                await processCommandBatch({
                  ...commandProcessParams,
                  payloads,
                });
              }
            : undefined,
        coalesceMaxBatch,
        coalesceMaxBytes: cmdEntry.options.coalesceMaxBytes,
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
                zodIssues: mapZodIssuesToLogContext(validation.error.issues),
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
                  zodIssues: mapZodIssuesToLogContext(validation.error.issues),
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

  hasHandlerQueues(): boolean {
    return this.handlerCount > 0;
  }

  hasSubscriberQueues(): boolean {
    return this.subscriberCount > 0;
  }

  hasProjectionQueues(): boolean {
    return this.projectionCount > 0;
  }

  hasStateProjectionQueues(): boolean {
    return this.stateProjectionCount > 0;
  }

  getHandlerQueue(
    handlerName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.queues.get(this.key("handler", handlerName)) as
      | EventSourcedQueueProcessor<EventType>
      | undefined;
  }

  getSubscriberQueue(
    subscriberName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.queues.get(this.key("subscriber", subscriberName)) as
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

  getStateProjectionQueue(
    projectionName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.queues.get(this.key("stateProjection", projectionName)) as
      | EventSourcedQueueProcessor<EventType>
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
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.logger.debug({ queueCount: this.queues.size }, "All queues closed");
  }

  /**
   * Registers a standalone job in the global queue.
   *
   * Unlike handler/projection queues that are tied to event processing,
   * standalone jobs are independent work items (e.g. deferred evaluation checks).
   *
   * Returns `null` when the global queue is not available (event sourcing disabled).
   */
  registerJob<P extends StandaloneJobPayload>({
    name,
    process,
    delay,
    deduplication,
    groupKeyFn,
    scoreFn,
    spanAttributes,
  }: {
    name: string;
    process: (payload: P) => Promise<void>;
    delay?: number;
    deduplication?: DeduplicationConfig<P>;
    groupKeyFn?: (payload: P) => string;
    scoreFn?: (payload: P) => number;
    spanAttributes?: (payload: P) => Record<string, string | number | boolean>;
  }): EventSourcedQueueProcessor<P> | null {
    if (!this.globalQueue || !this.globalJobRegistry) {
      return null;
    }

    const entry: JobRegistryEntry<P> = {
      groupKeyFn: groupKeyFn
        ? this.buildGroupKey({
            jobPath: `job/${name}`,
            getTenantId: (payload: P) => payload.tenantId,
            domainKeyFn: groupKeyFn,
          })
        : (payload: P) => `${payload.tenantId}/job/${name}`,
      scoreFn: scoreFn ?? ((payload: P) => (payload.occurredAt as number) ?? 0),
      process,
      delay,
      deduplication: deduplication
        ? resolveDeduplicationStrategy<P>(
            deduplication,
            (payload) => `${payload.tenantId}:${name}`,
          )
        : undefined,
      spanAttributes,
    };

    const facade = this.createFacade<P>("job", name, entry);
    this.queues.set(this.key("job", name), facade);
    return facade;
  }
}
