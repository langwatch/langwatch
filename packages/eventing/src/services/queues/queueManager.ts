import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { Command, CommandHandler } from "../../commands/command.ts";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass.ts";
import type { CommandSchema } from "../../commands/commandSchema.ts";
import type { AggregateType } from "../../domain/aggregateType.ts";
import type { CommandType } from "../../domain/commandType.ts";
import type { Event } from "../../domain/types.ts";
import { type KillSwitch } from "../../kill-switch/index.ts";
import type {
  DeduplicationConfig,
  DeduplicationStrategy,
  EventSourcedQueueProcessor,
  QueueSendOptions,
} from "../../queues/index.ts";
import { resolveDeduplicationStrategy } from "../../queues/index.ts";
import type { JobDelivery } from "../../queues/queue.types.ts";
import type { EventStoreReadContext } from "../../stores/eventStore.types.ts";
import { mapValidationIssues } from "../../utils/errors.ts";
import {
  type CommandHandlerOptions,
  processCommand,
  processCommandBatch,
} from "../commands/commandDispatcher.ts";
import { ConfigurationError, ValidationError } from "../errorHandling.ts";

const logger = createLogger("langwatch:event-sourcing:queue-manager");

/**
 * Missing occurredAt defaults to Date.now() instead of epoch (which was causing false old-age
 * metrics). Present values pass through untouched; GroupQueue validates them against the clock.
 */
function occurredAtScore(payload: { occurredAt?: unknown }): number {
  const occurredAt = payload.occurredAt;
  return occurredAt === undefined || occurredAt === null
    ? nowInstant().epochMilliseconds
    : (occurredAt as number);
}

/**
 * Metadata stored per job type in the global job registry.
 * Used by the global queue's process/groupKey/score callbacks to dispatch to the right handler.
 */
export interface JobRegistryEntry {
  process: (payload: any, delivery?: JobDelivery) => Promise<void>;
  groupKeyFn: (payload: any) => string;
  /**
   * The tenant this lane's payload carries — the SAME accessor `buildGroupKey`
   * prefixes the group key with. Recorded so the consumer can assert agreement
   * without re-deriving lane shapes (reactor lanes read `payload.event.tenantId`).
   */
  getTenantId: (payload: any) => string;
  /**
   * Exact group for aggregate-scoped migration pre-registration. Absent when
   * the job routes by a custom group key: that key is only knowable from a
   * payload, and preflight has to name every group before one exists.
   */
  preflightGroupKey?: (identity: { tenantId: string; aggregateId: string }) => string;
  scoreFn: (payload: any) => number;
  delay?: number;
  deduplication?: DeduplicationConfig<any>;
  spanAttributes?: (payload: any) => Record<string, string | number | boolean>;
  /**
   * Optional batch processor for group coalescing: with `coalesceMaxBatch
   * > 1` the queue may fold same-group jobs into one call (dispatched job
   * plus drained siblings, occurredAt order; first payload is dispatched).
   */
  processBatch?: (payloads: any[], delivery?: JobDelivery) => Promise<void>;
  /**
   * Max same-group jobs in one `processBatch` call, or payload-based resolver.
   */
  coalesceMaxBatch?: number | ((payload: any) => number);
  /**
   * Optional byte cap for a coalesced batch (ADR-066 pillar 2). Resolved by the
   * global queue per job; undefined falls back to the GroupQueue default.
   */
  coalesceMaxBytes?: number;
}

/**
 * How many same-group jobs fold here; resolver excludes unsafe payloads.
 */
export function resolveCoalesceMaxBatch(
  entry: Pick<JobRegistryEntry, "coalesceMaxBatch">,
  payload: Record<string, unknown>,
): number {
  const bound = entry.coalesceMaxBatch;
  if (typeof bound === "function") {
    return bound(payload);
  }
  return bound ?? 1;
}

interface CommandRegistryEntry<EventType extends Event> {
  handler: CommandHandler<Command<any>, EventType>;
  schema: CommandSchema<any, CommandType>;
  getAggregateId: (payload: any) => string;
  getGroupKey?: (payload: any) => string;
  options: CommandHandlerOptions<any>;
  commandName: string;
  commandType: CommandType;
  spanAttributes?: (payload: any) => Record<string, string | number | boolean>;
}

/**
 * The command queue's domain key: grouped by aggregate when
 * `serializeByAggregate` opts in, otherwise by the command's own group
 * key (falling back to its aggregate id).
 */
function resolveCommandDomainKey<EventType extends Event>(
  cmdEntry: CommandRegistryEntry<EventType>,
  payload: Record<string, unknown>,
): string {
  if (cmdEntry.options.serializeByAggregate) return cmdEntry.getAggregateId(payload);
  if (cmdEntry.getGroupKey) return cmdEntry.getGroupKey(payload);
  return cmdEntry.getAggregateId(payload);
}

/** Throws a `ValidationError` if `payload` fails the command's schema. */
function validateCommandPayload<EventType extends Event>(
  cmdEntry: CommandRegistryEntry<EventType>,
  payload: Record<string, unknown>,
): void {
  const validation = cmdEntry.schema.validate(payload);
  if (validation.success) return;
  throw new ValidationError(
    `Invalid payload for command type "${cmdEntry.commandType}". Validation failed.`,
    "payload",
    undefined,
    { commandType: cmdEntry.commandType, zodIssues: mapValidationIssues(validation.error.issues) },
  );
}

/**
 * Wraps a command's base facade with pre-send schema validation and the
 * migration preflight that claims groups BEFORE staging. Order matters:
 * an invalid payload never reaches preflight, and a refusal stops the send.
 */
function buildValidatingCommandFacade<EventType extends Event>(
  cmdEntry: CommandRegistryEntry<EventType>,
  baseFacade: EventSourcedQueueProcessor<Record<string, unknown>>,
  registerPreflight: (
    identities: readonly { tenantId: string; aggregateId: string }[],
  ) => Promise<void>,
): EventSourcedQueueProcessor<Record<string, unknown>> {
  const identityOf = (payload: Record<string, unknown>) => ({
    tenantId: String(payload.tenantId),
    aggregateId: String(cmdEntry.getAggregateId(payload)),
  });
  return {
    send: async (
      payload: Record<string, unknown>,
      options?: QueueSendOptions<Record<string, unknown>>,
    ) => {
      validateCommandPayload(cmdEntry, payload);
      await registerPreflight([identityOf(payload)]);
      return baseFacade.send(payload, options);
    },
    sendBatch: async (
      payloads: Record<string, unknown>[],
      options?: QueueSendOptions<Record<string, unknown>>,
    ) => {
      for (const payload of payloads) validateCommandPayload(cmdEntry, payload);
      await registerPreflight(payloads.map(identityOf));
      return baseFacade.sendBatch(payloads, options);
    },
    close: baseFacade.close,
    waitUntilReady: baseFacade.waitUntilReady,
  };
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
    groupKeyFn?: (event: E) => string;
    coalesceMaxBatch?: number;
  };
}

/**
 * Manages queue facades for event handlers, projections, commands, and
 * subscribers: per-job-type facades that inject routing metadata
 * (__pipelineName, __jobType, __jobName) into the global shared queue.
 */
export class QueueManager<EventType extends Event = Event> {
  private readonly aggregateType: AggregateType;
  private readonly pipelineName: string;
  private readonly logger = createLogger("langwatch:event-sourcing:queue-manager");
  private readonly globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  private readonly globalJobRegistry?: Map<string, JobRegistryEntry>;
  private readonly killSwitch?: KillSwitch;
  private readonly eventQueues = new Map<string, EventSourcedQueueProcessor<EventType>>();
  private readonly reactorQueues = new Map<
    string,
    EventSourcedQueueProcessor<{ event: EventType; foldState: unknown }>
  >();
  private readonly commandQueues = new Map<
    string,
    EventSourcedQueueProcessor<Record<string, unknown>>
  >();
  private readonly jobQueueClosers = new Map<string, () => Promise<void>>();
  private handlerCount = 0;
  private subscriberCount = 0;
  private stateProjectionCount = 0;
  private projectionCount = 0;
  private projectionSubscriberCount = 0;

  constructor({
    aggregateType,
    pipelineName,
    globalQueue,
    globalJobRegistry,
    killSwitch,
  }: {
    aggregateType: AggregateType;
    pipelineName: string;
    globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
    globalJobRegistry?: Map<string, JobRegistryEntry>;
    killSwitch?: KillSwitch;
  }) {
    this.aggregateType = aggregateType;
    this.pipelineName = pipelineName;
    this.globalQueue = globalQueue;
    this.globalJobRegistry = globalJobRegistry;
    this.killSwitch = killSwitch;
  }

  private createDefaultDeduplicationId(event: EventType): string {
    return `${String(event.tenantId)}:${event.aggregateType}:${String(event.aggregateId)}`;
  }

  /**
   * Builds a hierarchical group key function: `${tenantId}/${jobPath}/${domainKey}`.
   * jobPath reflects pipeline topology; domainKey defaults to
   * `${aggregateType}:${aggregateId}`, overridable via a custom fn.
   */
  private buildGroupKey<Payload>({
    jobPath,
    getTenantId,
    domainKeyFn,
  }: {
    jobPath: string;
    getTenantId: (payload: Payload) => string;
    domainKeyFn: (payload: Payload) => string;
  }): (payload: Payload) => string {
    return (payload: Payload) => `${getTenantId(payload)}/${jobPath}/${domainKeyFn(payload)}`;
  }

  /** The same key `buildGroupKey` produces, from an identity instead of a payload. */
  private buildPreflightGroupKey(
    jobPath: string,
  ): NonNullable<JobRegistryEntry["preflightGroupKey"]> {
    return ({ tenantId, aggregateId }) =>
      `${tenantId}/${jobPath}/${this.aggregateType}:${aggregateId}`;
  }

  /**
   * Names every group this pipeline's aggregates may reach before a command
   * is staged, so a migration's allow-list is complete. A custom-group-key
   * job contributes `undefined`, which the queue refuses — failing closed.
   */
  private async registerPreflightAggregateTargets(
    identities: readonly { tenantId: string; aggregateId: string }[],
  ): Promise<void> {
    const register = this.globalQueue?.registerPreflightGroups;
    const registry = this.globalJobRegistry;
    if (!register || !registry) return;

    await register.call(this.globalQueue, () => {
      const pipelinePrefix = `${this.pipelineName}:`;
      const entries = [...registry.entries()].filter(([key]) => key.startsWith(pipelinePrefix));
      return identities.flatMap((identity) =>
        entries.map(([, entry]) => entry.preflightGroupKey?.(identity)),
      );
    });
  }

  private key(
    type:
      | "handler"
      | "subscriber"
      | "stateProjection"
      | "projection"
      | "command"
      | "reactor"
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
   * Creates a facade that wraps the global queue, injecting
   * __pipelineName/__jobType/__jobName metadata and namespacing dedup IDs,
   * and registers the entry so the queue's callbacks dispatch to it.
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

    const stripInternal = (payload: Record<string, unknown>) => {
      const { __pipelineName: _p, __jobType: _t, __jobName: _n, ...clean } = payload;
      return clean;
    };

    // Namespace dedup IDs to avoid cross-pipeline/cross-type collisions
    const namespaceDedup = (
      dedup: DeduplicationConfig<any>,
    ): DeduplicationConfig<Record<string, unknown>> => ({
      ...dedup,
      makeId: (payload: Record<string, unknown>) =>
        `${pipelineName}/${jobType}/${jobName}/${dedup.makeId(stripInternal(payload))}`,
    });

    const namespacedEntryDedup: DeduplicationConfig<Record<string, unknown>> | undefined =
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

  // An arrow instance property, not a prototype method: tests hold a
  // QueueManager reference and extract this member (e.g. via vi.spyOn) to
  // assert on its calls, which is unsafe against a method-shorthand member.
  initializeHandlerQueues = (
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
  ): void => {
    this.initializeEventConsumerQueues({
      definitions: mapProjections,
      onEvent,
      onEventBatch,
      jobType: "handler",
      jobPath: "map",
      incrementCount: () => this.handlerCount++,
    });
  };

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
      const getTenantId = (event: EventType) => String(event.tenantId);
      const groupKeyFn = this.buildGroupKey({
        jobPath: `${jobPath}/${handlerName}`,
        getTenantId,
        domainKeyFn: customGroupKeyFn
          ? (event: EventType) => customGroupKeyFn(event)
          : (event: EventType) => `${event.aggregateType}:${String(event.aggregateId)}`,
      });
      const entry: JobRegistryEntry = {
        groupKeyFn,
        getTenantId,
        preflightGroupKey: customGroupKeyFn
          ? undefined
          : this.buildPreflightGroupKey(`${jobPath}/${handlerName}`),
        scoreFn: (event: any) => event.occurredAt ?? event.createdAt,
        process: async (event: EventType) => {
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
            ? (event: EventType) => `${String(event.tenantId)}:${customGroupKeyFn(event)}`
            : this.createDefaultDeduplicationId.bind(this),
        ),
        spanAttributes: handlerDef.options.spanAttributes,
      };

      const facade = this.createFacade<EventType>(jobType, handlerName, entry);
      this.eventQueues.set(this.key(jobType, handlerName), facade);
      incrementCount();
    }
  }

  // An arrow instance property: tests hold a QueueManager reference and
  // extract this member (e.g. via vi.spyOn) to assert on its calls, which is
  // unsafe against a method-shorthand member.
  initializeProjectionQueues = (
    projections: Record<
      string,
      {
        name: string;
        groupKeyFn?: (event: EventType) => string;
        scoreFn?: (event: EventType) => number;
        coalesceMaxBatch?: number;
        options?: { disabled?: boolean };
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
  ): void => {
    if (!this.globalQueue) {
      return;
    }

    for (const [projectionName] of Object.entries(projections)) {
      const projectionDef = projections[projectionName];
      if (!projectionDef) {
        continue;
      }

      const customGroupKeyFn = projectionDef.groupKeyFn;
      const getTenantId = (event: EventType) => String(event.tenantId);
      const groupKeyFn = this.buildGroupKey({
        jobPath: `${lane.jobPath}/${projectionName}`,
        getTenantId,
        domainKeyFn: customGroupKeyFn
          ? (event: EventType) => customGroupKeyFn(event)
          : (event: EventType) => `${event.aggregateType}:${String(event.aggregateId)}`,
      });
      const coalesceMaxBatch = projectionDef.coalesceMaxBatch;
      const entry: JobRegistryEntry = {
        groupKeyFn,
        getTenantId,
        preflightGroupKey: customGroupKeyFn
          ? undefined
          : this.buildPreflightGroupKey(`${lane.jobPath}/${projectionName}`),
        scoreFn: projectionDef.scoreFn ?? ((event: any) => event.occurredAt ?? event.createdAt),
        process: async (event: EventType, delivery?: JobDelivery) => {
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
                  isDeliveryContinuation: delivery?.isContinuation,
                });
              }
            : undefined,
        coalesceMaxBatch,
        spanAttributes: (event: EventType) => ({
          "projection.name": projectionName,
          "event.type": event.type,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
        }),
      };

      const facade = this.createFacade<EventType>(lane.queueType, projectionName, entry);
      this.eventQueues.set(this.key(lane.queueType, projectionName), facade);
      if (lane.queueType === "stateProjection") {
        this.stateProjectionCount++;
      } else {
        this.projectionCount++;
      }
    }
  };

  // An arrow instance property, for the same reason as initializeProjectionQueues above.
  initializeStateProjectionQueues = (
    projections: Parameters<QueueManager<EventType>["initializeProjectionQueues"]>[0],
    onEvent: Parameters<QueueManager<EventType>["initializeProjectionQueues"]>[1],
    onEventBatch?: Parameters<QueueManager<EventType>["initializeProjectionQueues"]>[2],
  ): void => {
    this.initializeProjectionQueues(projections, onEvent, onEventBatch, {
      queueType: "stateProjection",
      jobPath: "state",
    });
  };

  initializeCommandQueues<Payload extends Record<string, unknown>>(
    commandRegistrations: {
      name: string;
      handlerClass: CommandHandlerClass<any, any, EventType>;
      /** Pre-constructed instance — when provided, used instead of `new handlerClass()`. */
      handlerInstance?: CommandHandler<any, EventType>;
      options?: CommandHandlerOptions<Payload>;
    }[],
    storeEvents: (events: EventType[], context: EventStoreReadContext<EventType>) => Promise<void>,
    _pipelineName: string,
  ): void {
    if (!this.globalQueue) {
      return;
    }

    // Step 1: Build handler registry
    const commandRegistry = new Map<string, CommandRegistryEntry<EventType>>();
    for (const registration of commandRegistrations) {
      this.registerCommandHandlerEntry(registration, commandRegistry);
    }

    if (commandRegistry.size === 0) {
      return;
    }

    // Step 2: Register each command in the global queue and create facades
    for (const [cmdName, cmdEntry] of commandRegistry) {
      this.registerCommandQueueEntry(cmdName, cmdEntry, storeEvents);
    }
  }

  /** Registers a command's handler-registry entry (step 1 of `initializeCommandQueues`). */
  private registerCommandHandlerEntry<Payload extends Record<string, unknown>>(
    registration: {
      name: string;
      handlerClass: CommandHandlerClass<any, any, EventType>;
      handlerInstance?: CommandHandler<any, EventType>;
      options?: CommandHandlerOptions<Payload>;
    },
    commandRegistry: Map<string, CommandRegistryEntry<EventType>>,
  ): void {
    const handlerClass = registration.handlerClass;
    const schema = handlerClass.schema;
    const commandType = schema.type;
    const handlerInstance = registration.handlerInstance ?? new handlerClass();

    const getAggregateId =
      registration.options?.getAggregateId ?? handlerClass.getAggregateId.bind(handlerClass);

    const getGroupKey =
      registration.options?.getGroupKey ?? handlerClass.getGroupKey?.bind(handlerClass);

    const commandName = handlerClass.dispatcherName ?? registration.name;
    const commandKey = this.key("command", commandName);

    if (this.commandQueues.has(commandKey)) {
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
      spanAttributes:
        registration.options?.spanAttributes ?? handlerClass.getSpanAttributes?.bind(handlerClass),
    });
  }

  /** Registers one command's queue facade and job entry (step 2 of `initializeCommandQueues`). */
  private registerCommandQueueEntry(
    cmdName: string,
    cmdEntry: CommandRegistryEntry<EventType>,
    storeEvents: (events: EventType[], context: EventStoreReadContext<EventType>) => Promise<void>,
  ): void {
    const jobEntry = this.buildCommandJobEntry(cmdName, cmdEntry, storeEvents);
    const baseFacade = this.createFacade<Record<string, unknown>>("command", cmdName, jobEntry);
    const validatingFacade = buildValidatingCommandFacade(cmdEntry, baseFacade, (identities) =>
      this.registerPreflightAggregateTargets(identities),
    );
    this.commandQueues.set(this.key("command", cmdName), validatingFacade);
  }

  /** Builds the job-registry entry (group key, score, process/processBatch) for one command. */
  private buildCommandJobEntry(
    cmdName: string,
    cmdEntry: CommandRegistryEntry<EventType>,
    storeEvents: (events: EventType[], context: EventStoreReadContext<EventType>) => Promise<void>,
  ): JobRegistryEntry {
    const rawDedup = resolveDeduplicationStrategy(
      cmdEntry.options.deduplication as DeduplicationStrategy<any> | undefined,
      (payload: Record<string, unknown>) => {
        const key = cmdEntry.getGroupKey
          ? cmdEntry.getGroupKey(payload)
          : cmdEntry.getAggregateId(payload);
        return `${String(payload.tenantId)}:${this.aggregateType}:${String(key)}`;
      },
    );

    const getTenantId = (payload: Record<string, unknown>) => String(payload.tenantId);
    const commandGroupKeyFn = this.buildGroupKey({
      jobPath: cmdEntry.options.serializeByAggregate ? "command" : `command/${cmdName}`,
      getTenantId,
      domainKeyFn: (payload: Record<string, unknown>) => {
        const key = resolveCommandDomainKey(cmdEntry, payload);
        return `${this.aggregateType}:${String(key)}`;
      },
    });
    const coalesceMaxBatch = cmdEntry.options.coalesceMaxBatch;
    // A resolver decides per payload, so whether it coalesces is only known at
    // dispatch — its presence is the opt-in. A plain number opts in above 1.
    const coalescesAppends = typeof coalesceMaxBatch === "function" || (coalesceMaxBatch ?? 1) > 1;

    // ADR-066 (bounded coalescing): a grouped producer (`serializeByAggregate`
    // or a custom `getGroupKey`) that doesn't coalesce can flood the event
    // log with one tiny insert per item under high fan-in. Logged at
    // registration so the gap is found before it shows up as ClickHouse
    // small-parts pressure.
    const isGroupedProducer =
      Boolean(cmdEntry.options.serializeByAggregate) || Boolean(cmdEntry.getGroupKey);
    if (isGroupedProducer && !coalescesAppends) {
      this.logger.info(
        { pipeline: this.pipelineName, command: cmdName },
        "grouped command producer registered without append coalescing",
      );
    }

    // Shared across the single and batched processors — same command and
    // store; only the payload arity differs.
    const commandProcessParams = {
      commandType: cmdEntry.commandType,
      commandSchema: cmdEntry.schema,
      handler: cmdEntry.handler,
      getAggregateId: cmdEntry.getAggregateId,
      storeEventsFn: storeEvents,
      aggregateType: this.aggregateType,
      commandName: cmdEntry.commandName,
      pipelineName: this.pipelineName,
      killSwitch: this.killSwitch,
      killSwitchOptions: cmdEntry.options.killSwitch,
      logger,
    };

    return {
      groupKeyFn: commandGroupKeyFn,
      getTenantId,
      preflightGroupKey:
        cmdEntry.options.serializeByAggregate || !cmdEntry.getGroupKey
          ? this.buildPreflightGroupKey(
              cmdEntry.options.serializeByAggregate ? "command" : `command/${cmdName}`,
            )
          : undefined,
      scoreFn: cmdEntry.options.serializeByAggregate
        ? () => nowInstant().epochMilliseconds
        : (payload: Record<string, unknown>) => occurredAtScore(payload),
      process: async (payload: Record<string, unknown>) => {
        await processCommand({ ...commandProcessParams, payload });
      },
      // ADR-066 pillar 2: when the command opts into coalescing, fold a hot
      // aggregate's queued same-command jobs into one multi-row insert. The
      // GroupQueue only drains same-`__jobName` siblings, so every payload
      // here is this command type. Left undefined otherwise (per-job path).
      processBatch: coalescesAppends
        ? async (payloads: Record<string, unknown>[]) => {
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
  }

  initializeProjectionSubscriberQueues(
    subscribers: Record<
      string,
      {
        name: string;
        parentProjection: string;
        parentType: "fold" | "map";
        handler: {
          handle: (payload: { event: EventType; foldState: unknown }) => Promise<void>;
        };
        groupKeyFn?: (payload: { event: EventType; foldState: unknown }) => string;
        options?: {
          disabled?: boolean;
          delay?: number;
          deduplication?: DeduplicationStrategy<{
            event: EventType;
            foldState: unknown;
          }>;
        };
      }
    >,
    onEvent: (
      subscriberName: string,
      payload: { event: EventType; foldState: unknown },
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): void {
    if (!this.globalQueue) {
      return;
    }

    for (const [subscriberName, subscriberDef] of Object.entries(subscribers)) {
      const customGroupKeyFn = subscriberDef.groupKeyFn;
      const getTenantId = (payload: { event: EventType; foldState: unknown }) =>
        String(payload.event.tenantId);
      const subscriberGroupKeyFn = this.buildGroupKey({
        jobPath: `${subscriberDef.parentType}/${subscriberDef.parentProjection}/reactor/${subscriberName}`,
        getTenantId,
        domainKeyFn: customGroupKeyFn
          ? (payload: { event: EventType; foldState: unknown }) => customGroupKeyFn(payload)
          : (payload: { event: EventType; foldState: unknown }) =>
              `${payload.event.aggregateType}:${String(payload.event.aggregateId)}`,
      });
      const entry: JobRegistryEntry = {
        groupKeyFn: subscriberGroupKeyFn,
        getTenantId,
        preflightGroupKey: customGroupKeyFn
          ? undefined
          : this.buildPreflightGroupKey(
              `${subscriberDef.parentType}/${subscriberDef.parentProjection}/reactor/${subscriberName}`,
            ),
        scoreFn: (payload: { event: EventType; foldState: unknown }) => payload.event.createdAt,
        process: async (payload: { event: EventType; foldState: unknown }) => {
          await onEvent(subscriberName, payload, {
            tenantId: payload.event.tenantId,
          });
        },
        delay: subscriberDef.options?.delay,
        deduplication: subscriberDef.options?.deduplication
          ? resolveDeduplicationStrategy(subscriberDef.options.deduplication, (payload) =>
              this.createDefaultDeduplicationId(payload.event),
            )
          : undefined,
        spanAttributes: (payload: { event: EventType; foldState: unknown }) => ({
          "reactor.name": subscriberName,
          "event.type": payload.event.type,
          "event.id": payload.event.id,
          "event.aggregate_id": String(payload.event.aggregateId),
        }),
      };

      // `reactor` is the physical GroupQueue segment for projection-subscriber
      // jobs: `<tenantId>/<fold|map>/<projection>/reactor/<name>`.
      const facade = this.createFacade<{
        event: EventType;
        foldState: unknown;
      }>("reactor", subscriberName, entry);
      this.reactorQueues.set(this.key("reactor", subscriberName), facade);
      this.projectionSubscriberCount++;
    }
  }

  hasHandlerQueues(): boolean {
    return this.handlerCount > 0;
  }

  hasSubscriberQueues(): boolean {
    return this.subscriberCount > 0;
  }

  // An arrow instance property, for the same reason as initializeProjectionQueues above.
  hasProjectionQueues = (): boolean => {
    return this.projectionCount > 0;
  };

  hasStateProjectionQueues(): boolean {
    return this.stateProjectionCount > 0;
  }

  hasProjectionSubscriberQueues(): boolean {
    return this.projectionSubscriberCount > 0;
  }

  getHandlerQueue(handlerName: string): EventSourcedQueueProcessor<EventType> | undefined {
    return this.eventQueues.get(this.key("handler", handlerName));
  }

  getSubscriberQueue(subscriberName: string): EventSourcedQueueProcessor<EventType> | undefined {
    return this.eventQueues.get(this.key("subscriber", subscriberName));
  }

  // An arrow instance property, for the same reason as initializeProjectionQueues above.
  getProjectionQueue = (
    projectionName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined => {
    return this.eventQueues.get(this.key("projection", projectionName));
  };

  getStateProjectionQueue(
    projectionName: string,
  ): EventSourcedQueueProcessor<EventType> | undefined {
    return this.eventQueues.get(this.key("stateProjection", projectionName));
  }

  getProjectionSubscriberQueue(
    subscriberName: string,
  ): EventSourcedQueueProcessor<{ event: EventType; foldState: unknown }> | undefined {
    return this.reactorQueues.get(this.key("reactor", subscriberName));
  }

  getCommandQueue<Payload extends Record<string, unknown>>(
    commandName: string,
  ): EventSourcedQueueProcessor<Payload> | undefined {
    return this.commandQueues.get(this.key("command", commandName)) as
      | EventSourcedQueueProcessor<Payload>
      | undefined;
  }

  getCommandQueues(): Map<string, EventSourcedQueueProcessor<Record<string, unknown>>> {
    const result = new Map<string, EventSourcedQueueProcessor<Record<string, unknown>>>();
    const prefix = "command:";
    for (const [key, value] of this.commandQueues) {
      if (key.startsWith(prefix)) {
        result.set(key.slice(prefix.length), value);
      }
    }
    return result;
  }

  private queueCount(): number {
    return (
      this.eventQueues.size +
      this.reactorQueues.size +
      this.commandQueues.size +
      this.jobQueueClosers.size
    );
  }

  async waitUntilReady(): Promise<void> {
    if (this.globalQueue) {
      await this.globalQueue.waitUntilReady();
    }
    this.logger.debug({ queueCount: this.queueCount() }, "All queues ready");
  }

  async close(): Promise<void> {
    // Global queue lifecycle is owned by EventSourcing — facade close is a no-op.
    // We still call close on all facades for consistent behavior.
    await Promise.allSettled([
      ...[
        ...this.eventQueues.values(),
        ...this.reactorQueues.values(),
        ...this.commandQueues.values(),
      ].map((queue) => queue.close()),
      ...[...this.jobQueueClosers.values()].map((close) => close()),
    ]);
    this.logger.debug({ queueCount: this.queueCount() }, "All queues closed");
  }

  /**
   * Registers a standalone job in the global queue — independent work
   * (e.g. deferred evaluation checks), not tied to event processing.
   * Returns `null` when the global queue is unavailable.
   */
  registerJob<P extends Record<string, unknown>>({
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

    const getTenantId = (payload: P) => String(payload.tenantId);
    const entry: JobRegistryEntry = {
      groupKeyFn: groupKeyFn
        ? this.buildGroupKey({
            jobPath: `job/${name}`,
            getTenantId,
            domainKeyFn: groupKeyFn,
          })
        : (payload: P) => `${String(payload.tenantId)}/job/${name}`,
      getTenantId,
      preflightGroupKey: groupKeyFn ? undefined : ({ tenantId }) => `${tenantId}/job/${name}`,
      scoreFn: scoreFn ?? ((payload: P) => occurredAtScore(payload)),
      process,
      delay,
      deduplication: deduplication
        ? resolveDeduplicationStrategy(
            deduplication,
            (payload: P) => `${String(payload.tenantId)}:${name}`,
          )
        : undefined,
      spanAttributes,
    };

    const facade = this.createFacade<P>("job", name, entry);
    this.jobQueueClosers.set(this.key("job", name), () => facade.close());
    return facade;
  }
}
