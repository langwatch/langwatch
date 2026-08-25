import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { DisabledPipeline } from "./disabledPipeline";
import type { Event, Projection } from "./domain/types";
import { createEventCatalogue } from "./domain/definitions";
import type {
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./pipeline/staticBuilder.types";
import type { PipelineWithCommandHandlers, RegisteredPipeline } from "./pipeline/types";
import { ProcessRuntime } from "./process-manager/processRuntime";
import { InMemoryProcessStore } from "./process-manager/stores/inMemoryProcessStore";
import type { ProcessStore } from "./process-manager/stores/processStore.types";
import { ProjectionRegistry } from "./projections/projectionRegistry";
import type { ReplayMarkerChecker } from "./projections/replayMarkerCheck";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  JobDelivery,
} from "./queues";
import { EventSourcedQueueProcessorMemory } from "./queues/memory";
import type { ExecutionTarget, RetentionPolicyResolver } from "./runtime.types";
import { EventSourcingPipeline } from "./runtimePipeline";
import { QueueError } from "./services/errorHandling";
import type { JobRegistryEntry } from "./services/queues/queueManager";
import { resolveCoalesceMaxBatch } from "./services/queues/queueManager";
import type { EventStore } from "./stores/eventStore.types";
import { EventStoreMemory } from "./stores/eventStoreMemory";
import { EventRepositoryMemory } from "./stores/repositories/eventRepositoryMemory";

const logger = createLogger("langwatch:event-sourcing");

/**
 * Options for constructing an EventSourcing instance.
 */
export interface EventSourcingOptions {
  enabled?: boolean;
  eventStore?: EventStore;
  queueFactory?: (
    definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ) => EventSourcedQueueProcessor<Record<string, unknown>>;
  queueName?: string;
  consumersEnabled?: boolean;
  executionTarget?: ExecutionTarget;
  replayMarkerChecker?: ReplayMarkerChecker;
  retentionPolicyResolver?: RetentionPolicyResolver;
  configureGlobalProjections?: (registry: ProjectionRegistry<Event>) => void;
  /**
   * Durable persistence for `withProcess` declarations (inbox, state,
   * outbox). Production passes the PrismaProcessStore; when absent, an
   * in-memory store backs the processes (tests / no-Postgres dev).
   */
  processStore?: ProcessStore;
}

/**
 * Stores that can be injected for testing or custom configurations.
 */
interface RuntimeStores {
  eventStore: EventStore;
  globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
}

/**
 * Type helper to convert registered commands union to a record of queue processors.
 */
type CommandsToProcessors<Commands extends RegisteredCommand> = {
  [K in Commands as K["name"]]: EventSourcedQueueProcessor<
    K["payload"] & Record<string, unknown>
  >;
};

/**
 * Central class for event sourcing infrastructure.
 *
 * Owns the event store, ONE global queue, a global job registry,
 * the projection registry, and all registered pipelines.
 *
 * Features:
 * - Lazy initialization: stores are created on first access
 * - Graceful degradation: if disabled, no errors are thrown
 * - Infrastructure is supplied through explicit store and queue ports
 * - Testable: supports dependency injection via createForTesting() / createWithStores()
 * - Closeable: close() shuts down all pipelines, the projection registry, and the global queue
 */
export class EventSourcing {
  private readonly tracer = getLangWatchTracer("langwatch.event-sourcing.runtime");
  private readonly pipelines = new Map<string, PipelineWithCommandHandlers<any, any>>();
  private readonly _definitions: StaticPipelineDefinition<any, any, any>[] = [];
  private readonly projectionRegistry: ProjectionRegistry<Event>;

  // Infrastructure — lazily initialized
  private _eventStore?: EventStore;
  private _globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  private readonly _globalJobRegistry = new Map<string, JobRegistryEntry>();
  private _initialized = false;
  private _loggedDisabledWarning = false;

  // Options
  private readonly _enabled: boolean;
  private readonly _queueFactory?: EventSourcingOptions["queueFactory"];
  private readonly _queueName: string;
  private readonly _consumersEnabled: boolean;
  private readonly _executionTarget?: ExecutionTarget;
  private readonly _replayMarkerChecker?: ReplayMarkerChecker;
  private readonly _retentionPolicyResolver?: RetentionPolicyResolver;
  private readonly _processStore?: ProcessStore;
  private _processRuntimeInstance?: ProcessRuntime;

  constructor(options: EventSourcingOptions = {}) {
    this._enabled = options.enabled ?? true;
    this._eventStore = options.eventStore;
    this._queueFactory = options.queueFactory;
    this._queueName = options.queueName ?? "event-sourcing/jobs";
    this._consumersEnabled = options.consumersEnabled ?? true;
    this._executionTarget = options.executionTarget;
    this._replayMarkerChecker = options.replayMarkerChecker;
    this._retentionPolicyResolver = options.retentionPolicyResolver;
    this._processStore = options.processStore;

    this.projectionRegistry = new ProjectionRegistry<Event>();
    options.configureGlobalProjections?.(this.projectionRegistry);
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * The `withProcessManager` runtime — lazily constructed so an EventSourcing
   * instance with no process declarations pays nothing. Public so the
   * composition root can feed lifecycle envelopes from outside a pipeline.
   */
  get processRuntime(): ProcessRuntime {
    if (!this._processRuntimeInstance) {
      this._processRuntimeInstance = new ProcessRuntime({
        store: this._processStore ?? new InMemoryProcessStore(),
        consumersEnabled: this._consumersEnabled,
      });
    }
    return this._processRuntimeInstance;
  }

  get eventStore(): EventStore | undefined {
    this.ensureInitialized();
    return this._eventStore;
  }

  get globalQueue(): EventSourcedQueueProcessor<Record<string, unknown>> | undefined {
    this.ensureInitialized();
    return this._globalQueue;
  }

  get globalJobRegistry(): Map<string, JobRegistryEntry> {
    return this._globalJobRegistry;
  }

  getEventStore<EventType extends Event>(): EventStore<EventType> | undefined {
    return this.eventStore as EventStore<EventType> | undefined;
  }

  /**
   * Retrieves a registered pipeline by name.
   * Throws if the pipeline has not been registered yet.
   */
  getPipeline(name: string): PipelineWithCommandHandlers<any, any> {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(
        `Pipeline "${name}" not found. Available: ${Array.from(this.pipelines.keys()).join(", ")}`,
      );
    }
    return pipeline;
  }

  /** Returns the static definitions captured during register() calls. */
  get definitions(): ReadonlyArray<StaticPipelineDefinition<any, any, any>> {
    return this._definitions;
  }

  /**
   * Registers a static pipeline definition with the runtime infrastructure.
   * Takes a static definition created with `definePipeline({...})` and connects it
   * to ClickHouse, Redis, and other runtime dependencies.
   */
  register<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand = NoCommands,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
  ): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionTypes>,
    [Commands] extends [NoCommands]
      ? Record<string, EventSourcedQueueProcessor<any>>
      : CommandsToProcessors<Commands>
  > {
    return this.tracer.withActiveSpan(
      "EventSourcing.register",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": definition.metadata.name,
          "pipeline.aggregate_type": definition.metadata.aggregateType,
        },
      },
      () => {
        createEventCatalogue([
          ...this._definitions.map((registered) => registered.aggregate),
          definition.aggregate,
        ]);
        this._definitions.push(definition);

        type ReturnType = PipelineWithCommandHandlers<
          RegisteredPipeline<EventType, ProjectionTypes>,
          [Commands] extends [NoCommands]
            ? Record<string, EventSourcedQueueProcessor<any>>
            : CommandsToProcessors<Commands>
        >;

        if (!this._enabled || !this.eventStore) {
          logger.warn(
            {
              pipeline: definition.metadata.name,
              isEnabled: this._enabled,
              hasEventStore: !!this.eventStore,
            },
            "Returning DisabledPipeline - commands will be silently dropped",
          );
          this.logDisabledWarning({
            pipeline: definition.metadata.name,
          });
          const disabled = new DisabledPipeline<EventType, ProjectionTypes>(
            definition.metadata.name,
            definition.metadata.aggregateType,
            definition.metadata,
          ) as ReturnType;
          this.pipelines.set(definition.metadata.name, disabled);
          return disabled;
        }

        const eventStore = this.eventStore as EventStore<EventType>;

        const serviceOptions = buildServiceOptions(definition);

        // Process managers consume their declaring pipeline's committed
        // events directly through generated live subscribers.
        if (definition.processManagers.size > 0) {
          const artifacts = this.processRuntime.registerPipeline<EventType>({
            pipelineName: definition.metadata.name,
            processManagers: definition.processManagers,
          });
          if (artifacts.subscribers.length > 0) {
            serviceOptions.subscribers = [
              ...(serviceOptions.subscribers ?? []),
              ...artifacts.subscribers,
            ];
          }
        }

        // Initialize the projection registry if it has projections and hasn't been initialized yet
        if (
          this.projectionRegistry.hasProjections &&
          !this.projectionRegistry.isInitialized &&
          this._globalQueue
        ) {
          this.projectionRegistry.initialize(
            this._globalQueue,
            this._globalJobRegistry,
            this._executionTarget,
          );
        }

        // Create the pipeline
        const pipeline = new EventSourcingPipeline<EventType, ProjectionTypes>({
          name: definition.metadata.name,
          aggregateType: definition.metadata.aggregateType,
          allowedEventTypes: definition.aggregate.events.map((event) => event.type),
          eventStore,
          ...serviceOptions,
          globalQueue: this._globalQueue,
          globalJobRegistry: this._globalJobRegistry,
          metadata: definition.metadata,
          globalRegistry: this.projectionRegistry,
          executionTarget: this._executionTarget,
          replayMarkerChecker: this._replayMarkerChecker,
          retentionPolicyResolver: this._retentionPolicyResolver,
        });

        // Get command dispatchers
        const commandProcessors = pipeline.service.getCommandQueues();
        const dispatchers: Record<string, EventSourcedQueueProcessor<any>> = {};
        for (const [commandName, processor] of commandProcessors.entries()) {
          dispatchers[commandName] = processor;
        }

        const result = Object.assign(pipeline, {
          commands: dispatchers,
        }) as ReturnType;

        this.pipelines.set(definition.metadata.name, result);
        return result;
      },
    );
  }

  /**
   * Gracefully closes all pipelines, the projection registry, and the global queue.
   */
  async close(): Promise<void> {
    if (this._processRuntimeInstance) {
      try {
        await this._processRuntimeInstance.stop();
      } catch (error) {
        logger.error({ error }, "Failed to stop process runtime");
      }
    }
    for (const [name, pipeline] of this.pipelines) {
      try {
        await pipeline.service.close();
      } catch (error) {
        logger.error({ pipeline: name, error }, "Failed to close pipeline");
      }
    }
    // Close the global queue after all consumers are shut down
    if (this._globalQueue) {
      await this._globalQueue.close();
    }
    // AFTER the queue, never before. Closing the registry only releases its
    // router, and every dispatch that arrives afterwards drops its events with
    // nothing above it to retry them — `eventSourcingService` catches the
    // dispatch failure and carries on. While the queue is still draining it is
    // very much still storing events, so a registry closed first is a registry
    // discarding real work for the whole length of the drain: all 55 dropped
    // batches in the 48h to 2026-08-17 landed after their pod's SIGTERM, the
    // latest 26s into it. Ordering costs nothing here — `QueueManager.close()`
    // is a no-op for the globally-owned queue.
    if (this.projectionRegistry.isInitialized) {
      await this.projectionRegistry.close();
    }
    this.pipelines.clear();
  }

  private ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    if (!this._enabled) {
      logger.info("Event sourcing is disabled (enabled=false)");
      return;
    }

    this.initializeStores();
  }

  /**
   * Strips routing metadata and looks up the registry entry for a job payload.
   * Returns null when this worker has no handler for the job's routing key.
   *
   * Resolution runs several times per job (group key, score, span attributes,
   * then processing), so a miss logs at debug here and the processing path
   * raises it once, loudly, through `rejectUnroutableJob`.
   */
  private lookupEntry(
    payload: Record<string, unknown>,
  ): { entry: JobRegistryEntry; clean: Record<string, unknown> } | null {
    const pipelineName = payload.__pipelineName as string;
    const jobType = payload.__jobType as string;
    const jobName = payload.__jobName as string;

    if (!pipelineName || !jobType || !jobName) {
      logger.debug(
        { pipelineName, jobType, jobName },
        "Job payload missing routing metadata",
      );
      return null;
    }

    const registryKey = `${pipelineName}:${jobType}:${jobName}`;
    const entry = this._globalJobRegistry.get(registryKey);
    if (!entry) {
      logger.debug({ registryKey }, "No handler registered for job");
      return null;
    }
    const { __pipelineName: _p, __jobType: _t, __jobName: _n, ...clean } = payload;
    return { entry, clean };
  }

  /**
   * The identifying fields of a job payload, for a log line that has to name
   * WHICH record is at risk. Commands carry their aggregate id under the
   * pipeline's own key, events carry the framework's. Take whichever is
   * present and nothing else, because the rest of the payload is business
   * data and can hold an end user's identity.
   */
  private static jobIdentity(payload: Record<string, unknown>): Record<string, unknown> {
    const str = (value: unknown): string | undefined =>
      typeof value === "string" && value.length > 0 ? value : undefined;
    return {
      pipelineName: str(payload.__pipelineName) ?? null,
      jobType: str(payload.__jobType) ?? null,
      jobName: str(payload.__jobName) ?? null,
      tenantId: str(payload.tenantId) ?? null,
      aggregateType: str(payload.aggregateType) ?? null,
      aggregateId: str(payload.aggregateId) ?? null,
      eventType: str(payload.type) ?? null,
      gatewayRequestId: str(payload.gateway_request_id) ?? null,
    };
  }

  /**
   * Refuse a job this worker cannot route, instead of acknowledging it.
   *
   * Returning normally here would tell the queue the job SUCCEEDED: it is
   * removed, its group advances, and the payload is gone. For a spend command
   * that is money the ledger never records, and the gateway cannot notice
   * because the ingest route already answered 200 and its spool segment is
   * acked. The bug this replaces did exactly that, and a fleet running two
   * builds at once lost whichever records happened to land on the older
   * workers.
   *
   * Throwing puts the job back with the queue's normal bounded retry, so a
   * worker that does have the pipeline picks it up. This generic path never
   * decides on its own that a record is disposable.
   */
  private rejectUnroutableJob(
    payload: Record<string, unknown>,
    queueName: string,
  ): never {
    const identity = EventSourcing.jobIdentity(payload);
    logger.error(
      identity,
      "No handler registered for this job in this worker; rejecting it for retry rather than dropping it",
    );
    throw new QueueError(
      queueName,
      "process",
      "job routing key is not registered in this worker",
      identity,
    );
  }

  private initializeStores(): void {
    if (!this._eventStore) {
      this._eventStore = new EventStoreMemory(new EventRepositoryMemory());
      logger.debug("Using in-memory event store");
    }

    // Create the ONE global queue
    this.createGlobalQueue();

    logger.info(
      {
        eventStore: this._eventStore?.constructor.name ?? "none",
        queueProcessor: this._globalQueue?.constructor.name ?? "none",
      },
      "Event sourcing runtime initialized",
    );
  }

  private createGlobalQueue(): void {
    const queueName = this._queueName;

    const definition = {
      name: queueName,
      groupKey: (payload: Record<string, unknown>) => {
        const result = this.lookupEntry(payload);
        if (!result) return "__unknown__";
        return result.entry.groupKeyFn(result.clean);
      },
      score: (payload: Record<string, unknown>) => {
        const result = this.lookupEntry(payload);
        if (!result) return Date.now();
        return result.entry.scoreFn(result.clean);
      },
      spanAttributes: (payload: Record<string, unknown>) => {
        const result = this.lookupEntry(payload);
        if (!result) return {};
        if (!result.entry.spanAttributes) return {};
        return result.entry.spanAttributes(result.clean);
      },
      process: async (payload: Record<string, unknown>, delivery?: JobDelivery) => {
        const result = this.lookupEntry(payload);
        if (!result) {
          this.rejectUnroutableJob(payload, queueName);
        }
        // Forward the delivery. Dropping it here silently pinned
        // `deliveryAttempt` at 1 for every registry entry, which disabled the
        // fold store's merge-on-retry applied-id handling in the running
        // system (#6578) — the entries forward it, this wrapper was the only
        // point of loss.
        await result.entry.process(result.clean, delivery);
      },
      coalesceMaxBatch: (payload: Record<string, unknown>) => {
        const result = this.lookupEntry(payload);
        if (!result) return 1;
        // `clean`, not `payload`: a resolver sees the same shape the handler
        // will, without this queue's routing metadata.
        return resolveCoalesceMaxBatch(result.entry, result.clean);
      },
      coalesceMaxBytes: (payload: Record<string, unknown>) => {
        // Resolve the same way as coalesceMaxBatch: per-job via routing meta.
        // undefined falls back to the GroupQueue's DEFAULT_COALESCE_MAX_BYTES.
        const result = this.lookupEntry(payload);
        return result?.entry.coalesceMaxBytes;
      },
      processBatch: async (
        payloads: Record<string, unknown>[],
        delivery?: JobDelivery,
      ) => {
        if (payloads.length === 0) return;
        // A coalesced batch is always one group → one registry entry. Resolve
        // every payload and guard against a mixed/unknown batch (should never
        // happen — the GroupQueue only coalesces same-group jobs — but a stray
        // payload must never be misrouted to the wrong handler). On any mismatch
        // fall back to per-item processing.
        // Reject unroutable payloads UP FRONT so everything below works with a
        // fully-resolved list. `rejectUnroutableJob` returns `never`, so this
        // narrows `routed` to non-null for the compiler rather than for the
        // reader only — which is what lets the rest of this function drop its
        // non-null assertions (#6699). Behaviour is unchanged: a null entry
        // could only ever reach the heterogeneous branch, which rejected it
        // there anyway.
        const routed = payloads.map((payload) => {
          const result = this.lookupEntry(payload);
          if (!result) this.rejectUnroutableJob(payload, queueName);
          return result;
        });

        // A coalesced batch is always one group → one registry entry. Guard
        // against a mixed batch (should never happen — the GroupQueue only
        // coalesces same-group jobs — but a stray payload must never be
        // misrouted to the wrong handler) and fall back to per-item processing.
        const firstEntry = routed[0]?.entry;
        const batchHandler = firstEntry?.processBatch;
        if (!batchHandler || !routed.every((r) => r.entry === firstEntry)) {
          for (const result of routed) {
            await result.entry.process(result.clean, delivery);
          }
          return;
        }

        // Forward the delivery — see the `process` wrapper above (#6578).
        await batchHandler(
          routed.map((r) => r.clean),
          delivery,
        );
      },
    };

    this._globalQueue = this._queueFactory
      ? this._queueFactory(definition)
      : new EventSourcedQueueProcessorMemory(definition);
  }

  private logDisabledWarning(context: { pipeline?: string; command?: string }): void {
    if (!this._loggedDisabledWarning) {
      logger.warn(context, "Event sourcing is disabled. Operations will be no-ops.");
      this._loggedDisabledWarning = true;
    } else {
      logger.debug(context, "Event sourcing operation ignored (disabled)");
    }
  }

  // ---------------------------------------------------------------------------
  // Test factories
  // ---------------------------------------------------------------------------

  /**
   * Creates an EventSourcing instance for testing with injected stores.
   * Bypasses lazy initialization and env var detection.
   */
  static createForTesting(stores: Partial<RuntimeStores>): EventSourcing {
    const es = new EventSourcing({
      enabled: true,
      eventStore: stores.eventStore,
    });

    // Mark as initialized and inject stores directly
    es._initialized = true;
    es._eventStore = stores.eventStore;
    es._globalQueue = stores.globalQueue;

    return es;
  }

  /**
   * Creates an EventSourcing instance with explicit stores (for integration tests).
   */
  static createWithStores(options: {
    eventStore: EventStore;
    globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
    executionTarget?: ExecutionTarget;
    retentionPolicyResolver?: RetentionPolicyResolver;
  }): EventSourcing {
    const es = new EventSourcing({
      enabled: true,
      eventStore: options.eventStore,
      executionTarget: options.executionTarget,
      retentionPolicyResolver: options.retentionPolicyResolver,
    });

    es._initialized = true;
    es._eventStore = options.eventStore;
    if (options.globalQueue) {
      es._globalQueue = options.globalQueue;
    } else {
      es.createGlobalQueue();
    }

    return es;
  }
}

/**
 * Pure function to convert a StaticPipelineDefinition's Maps/arrays
 * into the flat arrays that EventSourcingPipeline expects.
 */
function buildServiceOptions<
  EventType extends Event,
  ProjectionTypes extends Record<string, Projection>,
>(definition: StaticPipelineDefinition<EventType, ProjectionTypes, any>) {
  // Pass class instances directly — do NOT spread.
  // Getters like `eventTypes` live on the prototype and are lost by `{...obj}`.
  const foldProjections = Array.from(definition.foldProjections.values()).map(
    ({ definition: fold }) => fold,
  );
  const stateProjections = Array.from(definition.stateProjections?.values() ?? []);

  const mapProjections = Array.from(definition.mapProjections.values()).map(
    ({ definition: mapProj }) => mapProj,
  );

  const commandRegistrations =
    definition.commands.length > 0
      ? definition.commands.map((cmd) => ({
          name: cmd.name,
          handlerClass: cmd.handlerClass,
          handlerInstance: cmd.handlerInstance,
          options: cmd.options,
        }))
      : undefined;

  const foldSubscriberList = Array.from(definition.foldSubscribers.values()).map(
    (entry) => ({
      foldName: entry.projectionName as string,
      definition: entry.definition,
    }),
  );

  const mapSubscriberList = Array.from(definition.mapSubscribers.values()).map(
    (entry) => ({
      mapName: entry.projectionName as string,
      definition: entry.definition,
    }),
  );

  const foldSubscribers = foldSubscriberList.length > 0 ? foldSubscriberList : undefined;
  const mapSubscribers = mapSubscriberList.length > 0 ? mapSubscriberList : undefined;
  const subscribers =
    definition.eventSubscribers.size > 0
      ? Array.from(definition.eventSubscribers.values())
      : undefined;

  return {
    foldProjections: foldProjections.length > 0 ? foldProjections : undefined,
    stateProjections: stateProjections.length > 0 ? stateProjections : undefined,
    mapProjections: mapProjections.length > 0 ? mapProjections : undefined,
    commandRegistrations,
    foldSubscribers,
    mapSubscribers,
    subscribers,
  };
}
