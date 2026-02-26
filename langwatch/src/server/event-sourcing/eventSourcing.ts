import type { ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { getLangWatchTracer } from "langwatch";
import { makeQueueName } from "~/server/background/queues/makeQueueName";
import { createLogger } from "~/utils/logger/server";
import { DisabledPipeline } from "./disabledPipeline";
import type { Event, Projection } from "./domain/types";
import type { NoCommands, RegisteredCommand, StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import type {
    PipelineWithCommandHandlers,
    RegisteredPipeline,
} from "./pipeline/types";
import { createBillingMeterDispatchReactor } from "./projections/global/billingMeterDispatch.reactor";
import { orgBillableEventsMeterProjection } from "./projections/global/orgBillableEventsMeter.mapProjection";
import { projectDailyBillableEventsProjection } from "./projections/global/projectDailyBillableEvents.foldProjection";
import { projectDailySdkUsageProjection } from "./projections/global/projectDailySdkUsage.foldProjection";
import { ProjectionRegistry } from "./projections/projectionRegistry";
import type { EventSourcedQueueProcessor } from "./queues";
import { GroupQueueProcessorBullMq } from "./queues/groupQueue/groupQueue";
import { EventSourcedQueueProcessorMemory } from "./queues/memory";
import { EventSourcingPipeline } from "./runtimePipeline";
import type { JobRegistryEntry } from "./services/queues/queueManager";
import { ConfigurationError } from "./services/errorHandling";
import { EventStoreClickHouse } from "./stores/eventStoreClickHouse";
import { EventStoreMemory } from "./stores/eventStoreMemory";
import type { EventStore } from "./stores/eventStore.types";
import { EventRepositoryClickHouse } from "./stores/repositories/eventRepositoryClickHouse";
import { EventRepositoryMemory } from "./stores/repositories/eventRepositoryMemory";

const logger = createLogger("langwatch:event-sourcing");

/**
 * Options for constructing an EventSourcing instance.
 */
export interface EventSourcingOptions {
  clickhouse?: ClickHouseClient;
  redis?: IORedis | Cluster | null;
  enabled?: boolean; // defaults to true
  isSaas?: boolean; // defaults to false
  processRole?: "web" | "worker";
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
  [K in Commands as K["name"]]: EventSourcedQueueProcessor<K["payload"] & Record<string, unknown>>;
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
  private readonly pipelines = new Map<string, PipelineWithCommandHandlers<any, any>>();
  private readonly projectionRegistry: ProjectionRegistry<Event>;

  // Infrastructure — lazily initialized
  private _eventStore?: EventStore;
  private _globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  private readonly _globalJobRegistry = new Map<string, JobRegistryEntry>();
  private _initialized = false;
  private _loggedDisabledWarning = false;

  // Options
  private readonly _enabled: boolean;
  private readonly _clickhouse?: ClickHouseClient | null;
  private readonly _redis?: IORedis | Cluster | null;
  private readonly _processRole?: "web" | "worker";

  constructor(options: EventSourcingOptions = {}) {
    this._enabled = options.enabled ?? true;
    this._clickhouse = options.clickhouse;
    this._redis = options.redis;
    this._processRole = options.processRole;

    // Create projection registry and register SaaS-only projections
    this.projectionRegistry = new ProjectionRegistry<Event>();
    if (options.isSaas) {
      this.projectionRegistry.registerFoldProjection(
        projectDailySdkUsageProjection,
      );
      this.projectionRegistry.registerFoldProjection(
        projectDailyBillableEventsProjection,
      );
      this.projectionRegistry.registerMapProjection(
        orgBillableEventsMeterProjection,
      );
      this.projectionRegistry.registerReactor(
        "projectDailyBillableEvents",
        createBillingMeterDispatchReactor({
          getUsageReportingQueue: async () =>
            (await import("~/server/background/queues/usageReportingQueue"))
              .usageReportingQueue,
        }),
      );
    }
  }

  get isEnabled(): boolean {
    return this._enabled;
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
        type ReturnType = PipelineWithCommandHandlers<
          RegisteredPipeline<EventType, ProjectionTypes>,
          [Commands] extends [NoCommands]
            ? Record<string, EventSourcedQueueProcessor<any>>
            : CommandsToProcessors<Commands>
        >;

        if (
          !this._enabled ||
          !this.eventStore
        ) {
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
      logger.info(
        "Event sourcing is disabled via ENABLE_EVENT_SOURCING=false",
      );
      return;
    }

    this.initializeStores();
  }

  /**
   * Strips routing metadata and looks up the registry entry for a job payload.
   */
  private lookupEntry(payload: Record<string, unknown>): { entry: JobRegistryEntry; clean: Record<string, unknown> } {
    const pipelineName = payload.__pipelineName as string;
    const jobType = payload.__jobType as string;
    const jobName = payload.__jobName as string;

    if (!pipelineName || !jobType || !jobName) {
      throw new ConfigurationError(
        "EventSourcing",
        `Job payload missing routing metadata (__pipelineName=${pipelineName}, __jobType=${jobType}, __jobName=${jobName})`,
      );
    }

    const registryKey = `${pipelineName}:${jobType}:${jobName}`;
    const entry = this._globalJobRegistry.get(registryKey);
    if (!entry) {
      throw new ConfigurationError(
        "EventSourcing",
        `Unknown job "${registryKey}" in global queue`,
      );
    }
    const { __pipelineName: _p, __jobType: _t, __jobName: _n, ...clean } = payload;
    return { entry, clean };
  }

  private initializeStores(): void {
    const isProduction = process.env.NODE_ENV === "production";
    const clickHouseEnabled = !!this._clickhouse;

    // Create event store
    if (clickHouseEnabled) {
      this._eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(this._clickhouse!),
      );
      logger.debug("Using ClickHouse event store");
    } else if (!isProduction) {
      // Only use memory stores in non-production environments
      this._eventStore = new EventStoreMemory(new EventRepositoryMemory());
      logger.debug("Using in-memory event store (non-production)");
    } else {
      // In production without ClickHouse, leave stores undefined
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
        queueProcessor: this._globalQueue ? (this._redis ? "GroupQueue" : "Memory") : "none",
      },
      "Event sourcing runtime initialized",
    );
  }

  private createGlobalQueue(): void {
    const queueName = makeQueueName("event-sourcing/jobs");

    const definition = {
      name: queueName,
      groupKey: (payload: Record<string, unknown>) => {
        const { entry, clean } = this.lookupEntry(payload);
        return entry.groupKeyFn(clean);
      },
      score: (payload: Record<string, unknown>) => {
        const { entry, clean } = this.lookupEntry(payload);
        return entry.scoreFn(clean);
      },
      spanAttributes: (payload: Record<string, unknown>) => {
        const { entry, clean } = this.lookupEntry(payload);
        if (!entry.spanAttributes) return {};
        return entry.spanAttributes(clean);
      },
      process: async (payload: Record<string, unknown>) => {
        const { entry, clean } = this.lookupEntry(payload);
        await entry.process(clean);
      },
    };

    const effectiveRedis = this._redis;
    if (effectiveRedis) {
      this._globalQueue = new GroupQueueProcessorBullMq(
        definition,
        effectiveRedis,
        { consumerEnabled: this._processRole !== "web" },
      );
    } else {
      this._globalQueue = new EventSourcedQueueProcessorMemory(definition);
    }
  }

  private logDisabledWarning(context: { pipeline?: string; command?: string }): void {
    if (!this._loggedDisabledWarning) {
      logger.warn(
        context,
        "Event sourcing is disabled via ENABLE_EVENT_SOURCING=false. Operations will be no-ops.",
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
  static createForTesting(
    stores: Partial<RuntimeStores>,
  ): EventSourcing {
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
    clickhouse?: ClickHouseClient;
    redis?: IORedis | Cluster;
  }): EventSourcing {
    const es = new EventSourcing({
      enabled: true,
      clickhouse: options.clickhouse,
      redis: options.redis,
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
  const foldProjections = Array.from(definition.foldProjections.values()).map(
    ({ definition: fold, options }) => ({
      ...fold,
      options: options ?? fold.options,
    }),
  );

  const mapProjections = Array.from(definition.mapProjections.values()).map(
    ({ definition: mapProj, options }) => ({
      ...mapProj,
      options: options ?? mapProj.options,
    }),
  );

  const commandRegistrations =
    definition.commands.length > 0
      ? definition.commands.map((cmd) => ({
          name: cmd.name,
          handlerClass: cmd.handlerClass,
          options: cmd.options,
        }))
      : undefined;

  const reactors =
    definition.reactors.size > 0
      ? Array.from(definition.reactors.values()).map((entry) => ({
          foldName: entry.foldName,
          definition: entry.definition,
        }))
      : undefined;

  return {
    foldProjections: foldProjections.length > 0 ? foldProjections : undefined,
    mapProjections: mapProjections.length > 0 ? mapProjections : undefined,
    commandRegistrations,
    reactors,
  };
}
