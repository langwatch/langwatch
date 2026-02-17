import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import type { EventStore } from "../library";
import type { EventSourcingConfig, EventSourcingConfigOptions } from "./config";
import { createEventSourcingConfig } from "./config";
import type { QueueProcessorFactory } from "./queue";
import { DefaultQueueProcessorFactory } from "./queue";
import { EventStoreClickHouse } from "./stores/eventStoreClickHouse";
import { EventStoreMemory } from "./stores/eventStoreMemory";
import { EventRepositoryClickHouse } from "./stores/repositories/eventRepositoryClickHouse";
import { EventRepositoryMemory } from "./stores/repositories/eventRepositoryMemory";
import { getClickHouseClient } from "../../clickhouse/client";
import { connection as redisConnection } from "../../redis";

const logger = createLogger("langwatch:event-sourcing:runtime");

/**
 * Stores that can be injected for testing or custom configurations.
 */
export interface RuntimeStores {
  eventStore: EventStore;
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
   * The Redis connection from config, if available.
   * Exposed so pipelines can pass it through to components that need Redis
   * (e.g. replay marker checks) without relying on the global singleton.
   */
  get redisConnection(): IORedis | Cluster | undefined {
    return this.config.redisConnection;
  }

  /**
   * The event store instance. Returns undefined if event sourcing is disabled.
   */
  get eventStore(): EventStore | undefined {
    this.ensureInitialized();
    return this._eventStore;
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

    // Create queue processor factory
    this._queueProcessorFactory = new DefaultQueueProcessorFactory(
      redisConnection,
    );

    logger.info(
      {
        eventStore: this._eventStore?.constructor.name ?? "none",
        queueProcessor: redisConnection ? "GroupQueue" : "Memory",
      },
      "Event sourcing runtime initialized",
    );
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
      queueProcessorFactory: QueueProcessorFactory;
    },
  ): EventSourcingRuntime {
    const runtime = new EventSourcingRuntime(config);

    runtime._initialized = true;
    runtime._eventStore = stores.eventStore;
    runtime._queueProcessorFactory = stores.queueProcessorFactory;

    return runtime;
  }
}

// Singleton instance stored in globalThis to survive module context isolation
// (turbopack bundles API routes separately, creating different module instances)
const globalForEventSourcing = globalThis as unknown as {
  eventSourcingRuntime: EventSourcingRuntime | null;
};

// Initialize to null if not already set
if (globalForEventSourcing.eventSourcingRuntime === undefined) {
  globalForEventSourcing.eventSourcingRuntime = null;
}

/**
 * Explicitly initialize event sourcing with provided clients.
 * Should be called during application startup for predictable initialization.
 *
 * This function is idempotent - if already initialized (either explicitly or via lazy init),
 * it will log and return without error.
 *
 * @example
 * ```typescript
 * // In app startup (start.ts, worker.ts)
 * import { initializeEventSourcing } from '~/server/event-sourcing';
 * import { getClickHouseClient } from '~/server/clickhouse/client';
 * import { connection as redis } from '~/server/redis';
 *
 * initializeEventSourcing({
 *   clickHouseClient: getClickHouseClient(),
 *   redisConnection: redis,
 * });
 * ```
 */
export function initializeEventSourcing(
  options: EventSourcingConfigOptions,
): void {
  if (globalForEventSourcing.eventSourcingRuntime) {
    logger.debug("Event sourcing already initialized, skipping");
    return;
  }
  globalForEventSourcing.eventSourcingRuntime = new EventSourcingRuntime(
    createEventSourcingConfig({
      clickHouseClient: options.clickHouseClient ?? undefined,
      redisConnection: options.redisConnection ?? undefined,
    }),
  );
  logger.info("Event sourcing initialized via initializeEventSourcing()");
}

/**
 * Initialize event sourcing for testing with in-memory stores.
 * No external dependencies or env vars required.
 *
 * @example
 * ```typescript
 * // In test-setup.ts or beforeAll
 * import { initializeEventSourcingForTesting } from '~/server/event-sourcing';
 *
 * initializeEventSourcingForTesting();
 * ```
 */
export function initializeEventSourcingForTesting(): void {
  if (globalForEventSourcing.eventSourcingRuntime) {
    resetEventSourcingRuntime();
  }
  globalForEventSourcing.eventSourcingRuntime = new EventSourcingRuntime(
    createEventSourcingConfig({
      clickHouseClient: null,
      redisConnection: null,
    }),
  );
  logger.debug("Event sourcing initialized for testing (in-memory stores)");
}

/**
 * Returns the singleton EventSourcingRuntime instance.
 * Auto-initializes lazily if not already initialized.
 */
export function getEventSourcingRuntime(): EventSourcingRuntime {
  if (!globalForEventSourcing.eventSourcingRuntime) {
    globalForEventSourcing.eventSourcingRuntime = new EventSourcingRuntime(
      createEventSourcingConfig({
        clickHouseClient: getClickHouseClient() ?? undefined,
        redisConnection: redisConnection ?? undefined,
      }),
    );
    logger.info(
      "Event sourcing auto-initialized via getEventSourcingRuntime()",
    );
  }
  return globalForEventSourcing.eventSourcingRuntime;
}

/**
 * Returns the singleton EventSourcingRuntime instance if initialized, null otherwise.
 * Use this when you want to check if event sourcing is available without throwing.
 */
export function getEventSourcingRuntimeOrNull(): EventSourcingRuntime | null {
  return globalForEventSourcing.eventSourcingRuntime;
}

/**
 * Resets the singleton instance. Only use in tests.
 */
export function resetEventSourcingRuntime(): void {
  globalForEventSourcing.eventSourcingRuntime = null;
}
