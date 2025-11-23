import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "../../../utils/clickhouse";
import { connection } from "../../redis";
import { EventStoreClickHouse } from "./stores/eventStoreClickHouse";
import { EventStoreMemory } from "./stores/eventStoreMemory";
import { EventRepositoryClickHouse } from "./stores/repositories/eventRepositoryClickHouse";
import { EventRepositoryMemory } from "./stores/repositories/eventRepositoryMemory";
import type { Event, Projection, EventStore } from "../library";
import { RedisDistributedLock } from "../library/utils/distributedLock";
import type { DistributedLock } from "../library/utils/distributedLock";
import { PipelineBuilder } from "./pipeline";
import type { QueueProcessorFactory } from "./queue";
import { defaultQueueProcessorFactory } from "./queue";

/**
 * Singleton that manages shared event sourcing infrastructure.
 * Provides a single event store instance that can be used by all pipelines,
 * since the database partitions by tenantId + aggregateType.
 *
 * **Design Considerations:**
 * - Uses singleton pattern for simplicity and shared state in production
 * - Automatically selects ClickHouse or Memory store based on availability
 * - Suitable for applications with a single database connection
 * - Supports dependency injection via constructor for testing
 *
 * **Usage:**
 * - Production: Use singleton via `EventSourcing.getInstance()` or `eventSourcing` export
 * - Testing: Use constructor injection: `new EventSourcing(mockEventStore)`
 */
export class EventSourcing {
  private static instance: EventSourcing | null = null;
  private readonly eventStore: EventStore;
  private readonly queueProcessorFactory: QueueProcessorFactory;
  private readonly distributedLock?: DistributedLock;
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.runtime",
  );

  constructor(
    eventStore?: EventStore,
    queueProcessorFactory?: QueueProcessorFactory,
    distributedLock?: DistributedLock,
  ) {
    this.eventStore = eventStore ?? this.createDefaultEventStore();
    this.queueProcessorFactory =
      queueProcessorFactory ?? defaultQueueProcessorFactory;

    // Create distributed lock from Redis if available and not explicitly provided
    this.distributedLock =
      distributedLock ??
      (connection ? new RedisDistributedLock(connection) : void 0);
  }

  /**
   * Creates the default event store based on ClickHouse availability.
   *
   * Auto-selects implementation based on environment:
   * - ClickHouse (production): If available, provides persistent storage
   * - Memory (development/testing): If unavailable, provides in-memory storage for local development
   */
  private createDefaultEventStore(): EventStore {
    const clickHouseClient = getClickHouseClient();
    return clickHouseClient
      ? new EventStoreClickHouse(
          new EventRepositoryClickHouse(clickHouseClient),
        )
      : new EventStoreMemory(new EventRepositoryMemory());
  }

  /**
   * Returns the singleton instance of EventSourcing.
   * Creates a new instance with auto-selected store on first call.
   */
  static getInstance(): EventSourcing {
    if (!EventSourcing.instance) {
      EventSourcing.instance = new EventSourcing();
    }
    return EventSourcing.instance;
  }

  /**
   * Returns the shared event store instance.
   *
   * This single instance handles all aggregate types by accepting aggregateType as a method parameter.
   * The store partitions data by tenantId + aggregateType internally, allowing a single instance
   * to serve multiple pipelines efficiently.
   */
  getEventStore<EventType extends Event>(): EventStore<EventType> {
    return this.eventStore as EventStore<EventType>;
  }

  /**
   * Starts building a new event sourcing pipeline.
   * Returns a builder that enforces required fields through TypeScript types.
   */
  registerPipeline<
    EventType extends Event,
    ProjectionType extends Projection = Projection,
  >(): PipelineBuilder<EventType, ProjectionType> {
    return this.tracer.withActiveSpan(
      "EventSourcing.registerPipeline",
      {
        kind: SpanKind.INTERNAL,
      },
      () => {
        return new PipelineBuilder<EventType, ProjectionType>(
          this.eventStore,
          this.queueProcessorFactory,
          this.distributedLock,
        );
      },
    );
  }
}

export const eventSourcing = EventSourcing.getInstance();
