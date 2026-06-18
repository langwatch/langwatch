import type { ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { getLangWatchTracer } from "langwatch";
import type { ProcessRole } from "~/server/app-layer/config";
import { makeQueueName } from "~/server/background/queues/makeQueueName";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import { createLogger } from "~/utils/logger/server";
import { DisabledPipeline } from "./disabledPipeline";
import type { Event, Projection } from "./domain/types";
import type { OutboxReactorDefinition } from "./outbox/outboxReactor.types";
import { adaptOutboxReactor } from "./outbox/outboxReactorAdapter";
import {
  cadenceGroupKey,
  isCadence,
  isSettle,
  type OutboxJob,
  settleGroupKey,
} from "./outbox/payload";
import type { OutboxRuntime } from "./outbox/setup";
import type {
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./pipeline/staticBuilder.types";
import type {
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline/types";
import { BILLING_REPORTING_PIPELINE_NAME } from "./pipelines/billing-reporting/pipeline";
import { createBillingMeterDispatchReactor } from "./projections/global/billingMeterDispatch.reactor";
import { orgBillableEventsMeterProjection } from "./projections/global/orgBillableEventsMeter.mapProjection";
import { projectDailySdkUsageProjection } from "./projections/global/projectDailySdkUsage.foldProjection";
import { ProjectionRegistry } from "./projections/projectionRegistry";
import { RedisReplayMarkerChecker } from "./projections/replayMarkerCheck";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "./queues";
import { GroupQueueProcessor } from "./queues/groupQueue/groupQueue";
import { EventSourcedQueueProcessorMemory } from "./queues/memory";
import type { ReactorDefinition } from "./reactors/reactor.types";
import { EventSourcingPipeline } from "./runtimePipeline";
import { ConfigurationError } from "./services/errorHandling";
import type { JobRegistryEntry } from "./services/queues/queueManager";
import type { EventStore } from "./stores/eventStore.types";
import { EventStoreClickHouse } from "./stores/eventStoreClickHouse";
import { EventStoreMemory } from "./stores/eventStoreMemory";
import { EventRepositoryClickHouse } from "./stores/repositories/eventRepositoryClickHouse";
import { EventRepositoryMemory } from "./stores/repositories/eventRepositoryMemory";

const logger = createLogger("langwatch:event-sourcing");

/**
 * Options for constructing an EventSourcing instance.
 */
export interface EventSourcingOptions {
  clickhouse?: ClickHouseClientResolver;
  redis?: IORedis | Cluster | null;
  enabled?: boolean; // defaults to true
  isSaas?: boolean; // defaults to false
  processRole?: ProcessRole;
  /** Optional outbox runtime (ADR-025 revision 3). When provided, the
   *  global queue routes settle/cadence payloads to its dispatcher and
   *  wires its audit adapter onto every lifecycle event. Non-outbox
   *  payloads flow through the normal registry — the runtime piggy-backs
   *  on the existing queue instead of standing up its own. */
  outbox?: OutboxRuntime;
  retentionPolicyResolver?: RetentionPolicyResolver;
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
 * - Environment-aware: auto-selects ClickHouse or Memory stores
 * - Testable: supports dependency injection via createForTesting() / createWithStores()
 * - Closeable: close() shuts down all pipelines, the projection registry, and the global queue
 */
export class EventSourcing {
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.runtime",
  );
  private readonly pipelines = new Map<
    string,
    PipelineWithCommandHandlers<any, any>
  >();
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
  private readonly _clickhouse?: ClickHouseClientResolver | null;
  private readonly _redis?: IORedis | Cluster | null;
  private readonly _processRole?: ProcessRole;
  private readonly _outbox?: OutboxRuntime;
  private readonly _retentionPolicyResolver?: RetentionPolicyResolver;

  constructor(options: EventSourcingOptions = {}) {
    this._enabled = options.enabled ?? true;
    this._clickhouse = options.clickhouse;
    this._redis = options.redis;
    this._processRole = options.processRole;
    this._outbox = options.outbox;
    this._retentionPolicyResolver = options.retentionPolicyResolver;

    // Create projection registry and register SaaS-only projections
    this.projectionRegistry = new ProjectionRegistry<Event>();
    if (options.isSaas) {
      this.projectionRegistry.registerFoldProjection(
        projectDailySdkUsageProjection,
      );
      this.projectionRegistry.registerMapProjection(
        orgBillableEventsMeterProjection,
      );
      this.projectionRegistry.registerMapReactor(
        "orgBillableEventsMeter",
        createBillingMeterDispatchReactor({
          getDispatch: () => {
            const pipeline = this.getPipeline(BILLING_REPORTING_PIPELINE_NAME);
            return (data) => pipeline.commands.reportUsageForMonth.send(data);
          },
        }),
      );
    }
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Register a reactor on a global fold projection.
   *
   * Must be called before the projection registry is initialized
   * (i.e., before the first pipeline is registered).
   *
   * Silently skips registration when the fold projection does not exist
   * (e.g. `projectDailySdkUsage` is only registered in SaaS mode).
   */
  registerGlobalFoldReactor(
    foldName: string,
    reactor: ReactorDefinition<Event>,
  ): void {
    try {
      this.projectionRegistry.registerReactor(foldName, reactor);
    } catch (error) {
      // Only suppress "fold not registered" errors — let wiring bugs (duplicates, etc.) fail fast
      if (error instanceof ConfigurationError && error.message.includes("fold not registered")) {
        logger.debug(
          { foldName, reactorName: reactor.name },
          "Skipping global fold reactor — fold not registered",
        );
        return;
      }
      throw error;
    }
  }

  get eventStore(): EventStore | undefined {
    this.ensureInitialized();
    return this._eventStore;
  }

  get globalQueue():
    | EventSourcedQueueProcessor<Record<string, unknown>>
    | undefined {
    this.ensureInitialized();
    return this._globalQueue;
  }

  get globalJobRegistry(): Map<string, JobRegistryEntry> {
    return this._globalJobRegistry;
  }

  get redisConnection(): IORedis | Cluster | undefined | null {
    return this._redis;
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
   * Takes a static definition (created with `definePipeline()`) and connects it
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

        const serviceOptions = buildServiceOptions(definition, this._outbox);

        // Initialize the projection registry if it has projections and hasn't been initialized yet
        if (
          this.projectionRegistry.hasProjections &&
          !this.projectionRegistry.isInitialized &&
          this._globalQueue
        ) {
          this.projectionRegistry.initialize(
            this._globalQueue,
            this._globalJobRegistry,
            this._processRole,
          );
        }

        // Create the pipeline
        const pipeline = new EventSourcingPipeline<EventType, ProjectionTypes>({
          name: definition.metadata.name,
          aggregateType: definition.metadata.aggregateType,
          eventStore,
          ...serviceOptions,
          globalQueue: this._globalQueue,
          globalJobRegistry: this._globalJobRegistry,
          metadata: definition.metadata,
          featureFlagService: definition.featureFlagService,
          globalRegistry: this.projectionRegistry,
          processRole: this._processRole,
          replayMarkerChecker: this._redis
            ? new RedisReplayMarkerChecker(this._redis)
            : undefined,
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
    for (const [name, pipeline] of this.pipelines) {
      try {
        await pipeline.service.close();
      } catch (error) {
        logger.error({ pipeline: name, error }, "Failed to close pipeline");
      }
    }
    if (this.projectionRegistry.isInitialized) {
      await this.projectionRegistry.close();
    }
    // Close the global queue after all consumers are shut down
    if (this._globalQueue) {
      await this._globalQueue.close();
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
   * Returns null when the job type is not (yet) registered — e.g. stale Redis
   * jobs from a previous deployment picked up before all pipelines register.
   */
  private lookupEntry(
    payload: Record<string, unknown>,
  ): { entry: JobRegistryEntry; clean: Record<string, unknown> } | null {
    const pipelineName = payload.__pipelineName as string;
    const jobType = payload.__jobType as string;
    const jobName = payload.__jobName as string;

    if (!pipelineName || !jobType || !jobName) {
      logger.warn(
        { pipelineName, jobType, jobName },
        "Job payload missing routing metadata, skipping",
      );
      return null;
    }

    const registryKey = `${pipelineName}:${jobType}:${jobName}`;
    const entry = this._globalJobRegistry.get(registryKey);
    if (!entry) {
      logger.warn(
        { registryKey },
        "Unknown job in global queue (pipeline not yet registered or removed), skipping",
      );
      return null;
    }
    const {
      __pipelineName: _p,
      __jobType: _t,
      __jobName: _n,
      ...clean
    } = payload;
    return { entry, clean };
  }

  private initializeStores(): void {
    const isProduction = process.env.NODE_ENV === "production";
    const clickHouseEnabled = !!this._clickhouse;

    // Create event store
    if (clickHouseEnabled) {
      this._eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(this._clickhouse!),
        this._retentionPolicyResolver,
      );
      logger.debug("Using ClickHouse event store");
    } else if (!isProduction) {
      // Only use memory stores in non-production environments
      this._eventStore = new EventStoreMemory(new EventRepositoryMemory());
      logger.debug("Using in-memory event store (non-production)");
    } else {
      // In production without ClickHouse, leave stores undefined
      // TODO: if you're hitting this, see the ClickHouse migration and setup guide:
      // https://github.com/langwatch/langwatch/blob/main/dev/docs/adr/004-docker-dev-environment.md
      logger.warn(
        "ClickHouse not available in production - event sourcing will be disabled. " +
          "Set CLICKHOUSE_URL to enable event sourcing.",
      );
      return;
    }

    // Create the ONE global queue
    this.createGlobalQueue();

    logger.info(
      {
        eventStore: this._eventStore?.constructor.name ?? "none",
        queueProcessor: this._globalQueue
          ? this._redis
            ? "GroupQueue"
            : "Memory"
          : "none",
      },
      "Event sourcing runtime initialized",
    );
  }

  private createGlobalQueue(): void {
    const queueName = makeQueueName("event-sourcing/jobs");

    // ADR-025 revision 3: outbox payloads (settle/cadence) ride this same
    // queue. Each callback peels off the outbox case first; everything else
    // falls through to the existing registry-based dispatch. The audit
    // adapter from the outbox runtime is wired below — it gates internally
    // on `isSettle || isCadence`, so non-outbox queue events no-op cheaply.
    const outbox = this._outbox;
    const isOutboxPayload = (
      payload: Record<string, unknown>,
    ): payload is OutboxJob => isSettle(payload) || isCadence(payload);

    const definition = {
      name: queueName,
      groupKey: (payload: Record<string, unknown>) => {
        if (isOutboxPayload(payload)) {
          return isSettle(payload)
            ? settleGroupKey(payload)
            : cadenceGroupKey(payload);
        }
        const result = this.lookupEntry(payload);
        if (!result) return "__unknown__";
        return result.entry.groupKeyFn(result.clean);
      },
      score: (payload: Record<string, unknown>) => {
        // Outbox jobs participate in the same per-tenant fairness budget
        // as projection / reactor work — a baseline score of 0 keeps them
        // in the default lane unless a future revision wants to weight
        // them explicitly.
        if (isOutboxPayload(payload)) return 0;
        const result = this.lookupEntry(payload);
        if (!result) return 0;
        return result.entry.scoreFn(result.clean);
      },
      spanAttributes: (payload: Record<string, unknown>) => {
        if (isOutboxPayload(payload)) {
          return { "outbox.stage": payload.stage };
        }
        const result = this.lookupEntry(payload);
        if (!result) return {};
        if (!result.entry.spanAttributes) return {};
        return result.entry.spanAttributes(result.clean);
      },
      process: async (payload: Record<string, unknown>) => {
        if (isOutboxPayload(payload)) {
          if (!outbox) {
            // Fail closed: throwing here keeps the job in the queue's
            // retryable state instead of ACKing and silently dropping a
            // notification. Operators see the error in queue metrics
            // and the worker boot wiring gets fixed.
            throw new Error(
              `Outbox payload (stage=${payload.stage}) arrived on a queue without a wired outbox runtime; failing closed so the row is retryable until the runtime is attached`,
            );
          }
          await outbox.dispatcher.process(payload);
          return;
        }
        const result = this.lookupEntry(payload);
        if (!result) {
          logger.warn({ payload }, "Skipping unknown job in global queue");
          return;
        }
        await result.entry.process(result.clean);
      },
      coalesceMaxBatch: (payload: Record<string, unknown>) => {
        if (isOutboxPayload(payload)) {
          // Settle is per-(trigger, trace) so coalescing makes no sense
          // — its dedup mode is already the collapsing primitive.
          // Cadence digest batches up to 100 same-window jobs into one
          // render+dispatch.
          return isSettle(payload) ? 1 : 100;
        }
        const result = this.lookupEntry(payload);
        return result?.entry.coalesceMaxBatch ?? 1;
      },
      processBatch: async (payloads: Record<string, unknown>[]) => {
        if (payloads.length === 0) return;
        // Outbox batch: the queue only coalesces same-group jobs, so a
        // homogeneous outbox batch goes through the dispatcher's
        // processBatch directly.
        const head = payloads[0]!;
        if (isOutboxPayload(head)) {
          if (!outbox) {
            // Fail closed (see process() above): throwing keeps the
            // rows retryable rather than ACKing and dropping the digest.
            throw new Error(
              `Outbox batch (stage=${head.stage}, count=${payloads.length}) on a queue without a wired outbox runtime; failing closed so the rows are retryable until the runtime is attached`,
            );
          }
          // Verify batch homogeneity before the cast — the GroupQueue
          // only coalesces same-group jobs so this should already hold,
          // but a stray non-outbox payload sneaking into an outbox
          // batch would misroute. Fall back to per-item processing on
          // mismatch so the non-outbox job lands in the normal lane.
          const allOutbox = payloads.every((p) => isOutboxPayload(p));
          if (!allOutbox) {
            // Isolate per-item failures: a single throwing payload must not
            // fail the whole fastq job and re-stage already-dispatched
            // siblings (which would re-fire outbox notifications on retry).
            // Throw only when every item failed — then nothing was
            // dispatched and a wholesale retry is safe.
            let failures = 0;
            let lastError: unknown;
            for (const p of payloads) {
              try {
                if (isOutboxPayload(p)) {
                  await outbox.dispatcher.process(p);
                } else {
                  const r = this.lookupEntry(p);
                  if (r) {
                    await r.entry.process(r.clean);
                  } else {
                    logger.warn(
                      { payload: p },
                      "Mixed outbox batch contained an unknown non-outbox payload; skipping",
                    );
                  }
                }
              } catch (error) {
                failures++;
                lastError = error;
                logger.error(
                  {
                    payload: p,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "Mixed outbox batch item failed; continuing with remaining items",
                );
              }
            }
            if (failures === payloads.length && failures > 0) {
              throw lastError instanceof Error
                ? lastError
                : new Error(String(lastError));
            }
            return;
          }
          await outbox.dispatcher.processBatch(payloads as OutboxJob[]);
          return;
        }
        // A coalesced batch is always one group → one registry entry. Resolve
        // every payload and guard against a mixed/unknown batch (should never
        // happen — the GroupQueue only coalesces same-group jobs — but a stray
        // payload must never be misrouted to the wrong handler). On any mismatch
        // fall back to per-item processing.
        const first = this.lookupEntry(payloads[0]!);
        const resolved = payloads.map((payload) => this.lookupEntry(payload));
        const homogeneous =
          !!first?.entry.processBatch &&
          resolved.every((r) => r?.entry === first.entry);
        if (!homogeneous) {
          for (const result of resolved) {
            if (result) await result.entry.process(result.clean);
          }
          return;
        }
        await first.entry.processBatch!(resolved.map((r) => r!.clean));
      },
      // The adapter is `QueueAuditAdapter<OutboxJob>`; the queue's payload
      // type is the widened `Record<string, unknown>`. The adapter gates
      // internally on `isSettle || isCadence` so any non-outbox payload
      // is a no-op — the cast is structurally safe.
      auditAdapter: outbox?.auditAdapter as
        | EventSourcedQueueDefinition<Record<string, unknown>>["auditAdapter"]
        | undefined,
    };
    // Outbox dedup configuration deliberately lives on the producer side
    // (settle: enqueueSettle's per-send override, cadence: TriggerSent
    // claim + per-trigger groupKey + processBatch coalescing). No queue-
    // level dedup — that would require a default makeId for non-outbox
    // payloads where no obvious dedup identity exists.

    const effectiveRedis = this._redis;
    if (effectiveRedis) {
      this._globalQueue = new GroupQueueProcessor(definition, effectiveRedis, {
        consumerEnabled: this._processRole === "worker",
      });
    } else {
      this._globalQueue = new EventSourcedQueueProcessorMemory(definition);
    }

    // The outbox runtime needs a back-reference to the queue so its
    // public `enqueueSettle` (and the dispatcher's internal
    // `enqueueCadence` re-enqueue) can send onto it. The cycle is
    // intentional and resolved by attaching after construction.
    outbox?.attachQueue(this._globalQueue);
  }

  private logDisabledWarning(context: {
    pipeline?: string;
    command?: string;
  }): void {
    if (!this._loggedDisabledWarning) {
      logger.warn(
        context,
        "Event sourcing is disabled. Operations will be no-ops.",
      );
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
    const es = new EventSourcing({ enabled: true });

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
    clickhouse?: ClickHouseClientResolver;
    redis?: IORedis | Cluster;
    processRole?: ProcessRole;
    retentionPolicyResolver?: RetentionPolicyResolver;
  }): EventSourcing {
    const es = new EventSourcing({
      enabled: true,
      clickhouse: options.clickhouse,
      redis: options.redis,
      processRole: options.processRole,
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
 *
 * `outbox` is threaded through so reactors registered via `.withOutbox`
 * are adapted into regular `ReactorDefinition`s that forward each
 * emitted `OutboxEnqueueRequest` to `outbox.enqueueSettle`. The
 * adapted reactors are merged into the `reactors`/`mapReactors` arrays
 * the runtime already consumes — no separate dispatch loop.
 */
function buildServiceOptions<
  EventType extends Event,
  ProjectionTypes extends Record<string, Projection>,
>(
  definition: StaticPipelineDefinition<EventType, ProjectionTypes, any>,
  outbox: OutboxRuntime | undefined,
) {
  // Pass class instances directly — do NOT spread.
  // Getters like `eventTypes` live on the prototype and are lost by `{...obj}`.
  const foldProjections = Array.from(definition.foldProjections.values()).map(
    ({ definition: fold }) => fold,
  );

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

  const adaptedFoldOutboxReactors = Array.from(
    definition.foldOutboxReactors.values(),
  ).map((entry) => ({
    foldName: entry.projectionName as string,
    definition: adaptOutboxReactor(
      entry.definition as OutboxReactorDefinition<EventType>,
      outbox,
    ),
  }));

  const adaptedMapOutboxReactors = Array.from(
    definition.mapOutboxReactors.values(),
  ).map((entry) => ({
    mapName: entry.projectionName as string,
    definition: adaptOutboxReactor(
      entry.definition as OutboxReactorDefinition<EventType>,
      outbox,
    ),
  }));

  const foldReactorList = [
    ...Array.from(definition.foldReactors.values()).map((entry) => ({
      foldName: entry.projectionName as string,
      definition: entry.definition,
    })),
    ...adaptedFoldOutboxReactors,
  ];

  const mapReactorList = [
    ...Array.from(definition.mapReactors.values()).map((entry) => ({
      mapName: entry.projectionName as string,
      definition: entry.definition,
    })),
    ...adaptedMapOutboxReactors,
  ];

  const reactors = foldReactorList.length > 0 ? foldReactorList : undefined;
  const mapReactors = mapReactorList.length > 0 ? mapReactorList : undefined;

  return {
    foldProjections: foldProjections.length > 0 ? foldProjections : undefined,
    mapProjections: mapProjections.length > 0 ? mapProjections : undefined,
    commandRegistrations,
    reactors,
    mapReactors,
  };
}
