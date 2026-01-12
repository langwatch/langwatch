import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger";
import type { EventStore } from "../library";
import type { ProcessorCheckpointStore } from "../library/stores/eventHandlerCheckpointStore.types";
import type { DistributedLock } from "../library/utils/distributedLock";
import { RedisDistributedLock } from "../library/utils/distributedLock";
import type { EventSourcingConfig } from "./config";
import { createEventSourcingConfig } from "./config";
import type { QueueProcessorFactory } from "./queue";
import { DefaultQueueProcessorFactory } from "./queue";
import { CheckpointCacheRedis } from "./stores/checkpointCacheRedis";
import { EventStoreClickHouse } from "./stores/eventStoreClickHouse";
import { EventStoreMemory } from "./stores/eventStoreMemory";
import { ProcessorCheckpointStoreClickHouse } from "./stores/processorCheckpointStoreClickHouse";
import { ProcessorCheckpointStoreMemory } from "./stores/processorCheckpointStoreMemory";
import { CheckpointRepositoryClickHouse } from "./stores/repositories/checkpointRepositoryClickHouse";
import { CheckpointRepositoryMemory } from "./stores/repositories/checkpointRepositoryMemory";
import { EventRepositoryClickHouse } from "./stores/repositories/eventRepositoryClickHouse";
import { EventRepositoryMemory } from "./stores/repositories/eventRepositoryMemory";

const logger = createLogger("langwatch:event-sourcing:runtime");

/**
 * Stores that can be injected for testing or custom configurations.
 */
export interface RuntimeStores {
  eventStore: EventStore;
  checkpointStore?: ProcessorCheckpointStore;
  distributedLock?: DistributedLock;
  queueProcessorFactory?: QueueProcessorFactory;
}

/**
 * Central runtime class for event sourcing infrastructure.
 *
 * Features:
 * - Lazy initialization: stores are created on first access
 * - Graceful degradation: if disabled, no errors are thrown
 * - Environment-aware: auto-selects ClickHouse or Memory stores
 * - Testable: supports dependency injection via createForTesting()
 */
export class EventSourcingRuntime {
  private _eventStore?: EventStore;
  private _checkpointStore?: ProcessorCheckpointStore;
  private _distributedLock?: DistributedLock;
  private _queueProcessorFactory?: QueueProcessorFactory;
  private _initialized = false;
  private _loggedDisabledWarning = false;

  constructor(private readonly config: EventSourcingConfig) {}

  /**
   * Whether event sourcing is enabled.
   * When false, pipelines will be no-ops that log warnings.
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Whether ClickHouse is available and enabled.
   */
  get isClickHouseEnabled(): boolean {
    return this.config.clickHouseEnabled && !!this.config.clickHouseClient;
  }

  /**
   * The event store instance. Returns undefined if event sourcing is disabled.
   */
  get eventStore(): EventStore | undefined {
    this.ensureInitialized();
    return this._eventStore;
  }

  /**
   * The checkpoint store instance. Returns undefined if event sourcing is disabled.
   */
  get checkpointStore(): ProcessorCheckpointStore | undefined {
    this.ensureInitialized();
    return this._checkpointStore;
  }

  /**
   * The distributed lock instance. Returns undefined if Redis is unavailable.
   */
  get distributedLock(): DistributedLock | undefined {
    this.ensureInitialized();
    return this._distributedLock;
  }

  /**
   * The queue processor factory instance.
   */
  get queueProcessorFactory(): QueueProcessorFactory | undefined {
    this.ensureInitialized();
    return this._queueProcessorFactory;
  }

  /**
   * Log a warning that event sourcing is disabled.
   * Only logs once per runtime instance.
   */
  logDisabledWarning(context: { pipeline?: string; command?: string }): void {
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

  private ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    if (!this.config.enabled) {
      if (this.config.isBuildTime) {
        logger.warn("Event sourcing disabled during build phase");
      } else {
        logger.info(
          "Event sourcing is disabled via ENABLE_EVENT_SOURCING=false",
        );
      }
      return;
    }

    this.initializeStores();
  }

  private initializeStores(): void {
    const {
      clickHouseEnabled,
      clickHouseClient,
      redisConnection,
      isTestEnvironment,
      forceClickHouseInTests,
    } = this.config;

    const isProduction = process.env.NODE_ENV === "production";

    // Create event store
    if (clickHouseEnabled && clickHouseClient) {
      this._eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(clickHouseClient),
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

    // Create checkpoint store with test environment handling
    this._checkpointStore = this.createCheckpointStore(
      clickHouseEnabled,
      clickHouseClient,
      isTestEnvironment,
      forceClickHouseInTests,
    );

    // Create distributed lock if Redis is available
    if (redisConnection) {
      this._distributedLock = new RedisDistributedLock(redisConnection);
      logger.debug("Using Redis distributed lock");
    } else {
      logger.debug("Distributed lock unavailable (no Redis connection)");
    }

    // Create queue processor factory
    this._queueProcessorFactory = new DefaultQueueProcessorFactory(
      redisConnection,
    );

    logger.info(
      {
        eventStore: this._eventStore?.constructor.name ?? "none",
        checkpointStore: this._checkpointStore?.constructor.name ?? "none",
        distributedLock: this._distributedLock ? "Redis" : "none",
        queueProcessor: redisConnection ? "BullMQ" : "Memory",
      },
      "Event sourcing runtime initialized",
    );
  }

  private createCheckpointStore(
    clickHouseEnabled: boolean,
    clickHouseClient: ClickHouseClient | undefined,
    isTestEnvironment: boolean,
    forceClickHouseInTests: boolean,
  ): ProcessorCheckpointStore | undefined {
    const isProduction = process.env.NODE_ENV === "production";

    // In test environment, use memory unless forced to use ClickHouse
    if (isTestEnvironment && !forceClickHouseInTests) {
      logger.debug("Using in-memory checkpoint store (test environment)");
      return new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
    }

    // Use ClickHouse if available and enabled
    if (clickHouseEnabled && clickHouseClient) {
      logger.debug("Using ClickHouse checkpoint store");

      // Create Redis cache if Redis connection is available
      const cache = this.config.redisConnection
        ? new CheckpointCacheRedis(this.config.redisConnection)
        : undefined;

      if (cache) {
        logger.info(
          "Redis checkpoint cache enabled for fast checkpoint visibility",
        );
      } else {
        logger.warn(
          "Redis checkpoint cache disabled (no Redis connection) - may cause ordering retries",
        );
      }

      return new ProcessorCheckpointStoreClickHouse(
        new CheckpointRepositoryClickHouse(clickHouseClient),
        cache,
      );
    }

    // In production without ClickHouse, return undefined
    if (isProduction) {
      logger.warn("No checkpoint store in production without ClickHouse");
      return void 0;
    }

    // Fallback to memory in non-production
    logger.debug("Using in-memory checkpoint store (non-production)");
    return new ProcessorCheckpointStoreMemory(new CheckpointRepositoryMemory());
  }

  /**
   * Creates a runtime instance for testing with injected stores.
   * Bypasses lazy initialization and env var detection.
   */
  static createForTesting(
    stores: Partial<RuntimeStores>,
  ): EventSourcingRuntime {
    const runtime = new EventSourcingRuntime({
      enabled: true,
      clickHouseEnabled: false,
      forceClickHouseInTests: false,
      isTestEnvironment: true,
      isBuildTime: false,
      clickHouseClient: void 0,
      redisConnection: void 0,
    });

    // Mark as initialized and inject stores directly
    runtime._initialized = true;
    runtime._eventStore = stores.eventStore;
    runtime._checkpointStore = stores.checkpointStore;
    runtime._distributedLock = stores.distributedLock;
    runtime._queueProcessorFactory = stores.queueProcessorFactory;

    return runtime;
  }

  /**
   * Creates a runtime instance with explicit stores (for integration tests).
   */
  static createWithStores(
    config: EventSourcingConfig,
    stores: {
      eventStore: EventStore;
      checkpointStore: ProcessorCheckpointStore;
      queueProcessorFactory: QueueProcessorFactory;
      distributedLock?: DistributedLock;
    },
  ): EventSourcingRuntime {
    const runtime = new EventSourcingRuntime(config);

    runtime._initialized = true;
    runtime._eventStore = stores.eventStore;
    runtime._checkpointStore = stores.checkpointStore;
    runtime._queueProcessorFactory = stores.queueProcessorFactory;
    runtime._distributedLock = stores.distributedLock;

    return runtime;
  }
}

// Singleton instance
let _runtime: EventSourcingRuntime | null = null;

/**
 * Returns the singleton EventSourcingRuntime instance.
 * Creates one on first call using auto-detected config.
 */
export function getEventSourcingRuntime(): EventSourcingRuntime {
  if (!_runtime) {
    _runtime = new EventSourcingRuntime(createEventSourcingConfig());
  }
  return _runtime;
}

/**
 * Resets the singleton instance. Only use in tests.
 */
export function resetEventSourcingRuntime(): void {
  _runtime = null;
}
