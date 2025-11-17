import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { EventStream } from "../core/eventStream";
import type {
  Event,
  EventOrderingStrategy,
  Projection,
  ProjectionMetadata,
} from "../core/types";
import type {
  EventStore,
  EventStoreListCursor,
  EventStoreReadContext,
} from "../stores/eventStore";
import type {
  ProjectionStore,
  ProjectionStoreReadContext,
} from "../stores/projectionStore.types";
import type { EventHandler } from "../processing/eventHandler";
import { EventUtils } from "../utils/event.utils";

export interface EventSourcingHooks<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  beforeHandle?(
    stream: EventStream<AggregateId, EventType>,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
  afterHandle?(
    stream: EventStream<AggregateId, EventType>,
    projection: ProjectionType,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
  beforePersist?(
    projection: ProjectionType,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
  afterPersist?(
    projection: ProjectionType,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
}

export interface EventSourcingOptions<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  ordering?: EventOrderingStrategy<EventType>;
  hooks?: EventSourcingHooks<AggregateId, EventType>;
}

export interface RebuildProjectionOptions<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  eventStoreContext?: EventStoreReadContext<AggregateId, EventType>;
  projectionStoreContext?: ProjectionStoreReadContext;
}

export interface BulkRebuildCheckpoint<AggregateId = string> {
  /**
   * Cursor pointing to the next position in the aggregate listing.
   * When undefined, there are no more aggregates to process.
   */
  cursor?: EventStoreListCursor;
  /**
   * Aggregate ID of the last successfully processed projection.
   * Useful for debugging and external progress tracking.
   */
  lastAggregateId?: AggregateId;
  /**
   * Total number of aggregates processed so far across all batches.
   */
  processedCount: number;
}

export interface BulkRebuildProgress<AggregateId = string> {
  checkpoint: BulkRebuildCheckpoint<AggregateId>;
}

export interface BulkRebuildOptions<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  /**
   * Maximum number of aggregate IDs to process per batch.
   * Implementations may use a smaller internal limit if needed.
   */
  batchSize?: number;
  eventStoreContext?: EventStoreReadContext<AggregateId, EventType>;
  projectionStoreContext?: ProjectionStoreReadContext;
  /**
   * Optional checkpoint to resume from.
   */
  resumeFrom?: BulkRebuildCheckpoint<AggregateId>;
  /**
   * Optional callback invoked after each aggregate is processed.
   */
  onProgress?: (
    progress: BulkRebuildProgress<AggregateId>,
  ) => Promise<void> | void;
}

export interface EventSourcingServiceOptions<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  eventStore: EventStore<AggregateId, EventType>;
  projectionStore: ProjectionStore<AggregateId, ProjectionType>;
  eventHandler: EventHandler<AggregateId, EventType, ProjectionType>;
  serviceOptions?: EventSourcingOptions<AggregateId, EventType>;
}

/**
 * Main service that orchestrates event sourcing.
 * Coordinates between event stores, projection stores, and event handlers.
 */
export class EventSourcingService<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  private readonly tracer = getLangWatchTracer("EventSourcingService");

  private readonly eventStore: EventStore<AggregateId, EventType>;
  private readonly projectionStore: ProjectionStore<AggregateId, ProjectionType>;
  private readonly eventHandler: EventHandler<
    AggregateId,
    EventType,
    ProjectionType
  >;
  private readonly options: EventSourcingOptions<AggregateId, EventType>;

  constructor({
    eventStore,
    projectionStore,
    eventHandler,
    serviceOptions,
  }: EventSourcingServiceOptions<
    AggregateId,
    EventType,
    ProjectionType
  >) {
    this.eventStore = eventStore;
    this.projectionStore = projectionStore;
    this.eventHandler = eventHandler;
    this.options = serviceOptions ?? {};
  }

  /**
   * Rebuilds the projection for a specific aggregate by reprocessing all its events.
   * @param aggregateId - The aggregate to rebuild projection for
   * @returns The rebuilt projection
   */
  async rebuildProjection(
    aggregateId: AggregateId,
    options?: RebuildProjectionOptions<AggregateId, EventType>,
  ): Promise<ProjectionType> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.rebuildProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": String(aggregateId),
        },
      },
      async (span) => {
        const events = await this.eventStore.getEvents(
          aggregateId,
          options?.eventStoreContext,
        );
        const stream = this.createEventStream(aggregateId, events);
        const metadata = EventUtils.buildProjectionMetadata(stream);

        span.setAttributes({
          "event.count": metadata.eventCount,
          "event.first_timestamp": metadata.firstEventTimestamp ?? void 0,
          "event.last_timestamp": metadata.lastEventTimestamp ?? void 0,
        });

        await this.options.hooks?.beforeHandle?.(stream, metadata);
        const projection = await this.eventHandler.handle(stream);
        await this.options.hooks?.afterHandle?.(stream, projection, metadata);

        await this.options.hooks?.beforePersist?.(projection, metadata);
        await this.projectionStore.storeProjection(
          projection,
          options?.projectionStoreContext,
        );
        await this.options.hooks?.afterPersist?.(projection, metadata);

        return projection;
      },
    );
  }

  /**
   * Gets the current projection for an aggregate, rebuilding if necessary.
   * @param aggregateId - The aggregate to get projection for
   * @returns The current projection
   */
  async getProjection(
    aggregateId: AggregateId,
    options?: RebuildProjectionOptions<AggregateId, EventType>,
  ): Promise<ProjectionType> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.getProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": String(aggregateId),
        },
      },
      async (span) => {
        let projection = await this.projectionStore.getProjection(
          aggregateId,
          options?.projectionStoreContext,
        );

        if (!projection) {
          span.addEvent("projection.not_found");
          projection = await this.rebuildProjection(aggregateId, options);
        } else {
          span.addEvent("projection.found");
        }

        return projection;
      },
    );
  }

  /**
   * Checks if a projection exists for an aggregate without rebuilding.
   * @param aggregateId - The aggregate to check
   * @returns True if projection exists
   */
  async hasProjection(aggregateId: AggregateId): Promise<boolean> {
    const projection = await this.projectionStore.getProjection(aggregateId);
    return projection !== null;
  }

  /**
   * Forces a rebuild of the projection even if it already exists.
   * @param aggregateId - The aggregate to rebuild projection for
   * @returns The rebuilt projection
   */
  async forceRebuildProjection(
    aggregateId: AggregateId,
    options?: RebuildProjectionOptions<AggregateId, EventType>,
  ): Promise<ProjectionType> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.forceRebuildProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": String(aggregateId),
        },
      },
      async () => {
        return await this.rebuildProjection(aggregateId, options);
      },
    );
  }

  /**
   * Rebuilds projections for many aggregates in batches.
   * Intended for reprocessing scenarios (all, by tenant, by trace, since timestamp).
   */
  async rebuildProjectionsInBatches(
    options?: BulkRebuildOptions<AggregateId, EventType>,
  ): Promise<BulkRebuildCheckpoint<AggregateId>> {
    const safeOptions = options ?? {};
    const batchSize = safeOptions.batchSize && safeOptions.batchSize > 0
      ? safeOptions.batchSize
      : 100;

    return await this.tracer.withActiveSpan(
      "EventSourcingService.rebuildProjectionsInBatches",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "batch.size": batchSize,
        },
      },
      async (span) => {
        let processedCount = safeOptions.resumeFrom?.processedCount ?? 0;
        let cursor: EventStoreListCursor | undefined =
          safeOptions.resumeFrom?.cursor;
        let lastAggregateId: AggregateId | undefined =
          safeOptions.resumeFrom?.lastAggregateId;

        // Loop until the event store indicates there are no more aggregate IDs.
        // This method is deliberately conservative: callers can chunk work further
        // at a higher level if they want finer-grained jobs.
        if (!this.eventStore.listAggregateIds) {
          throw new Error(
            "EventStore.listAggregateIds is not implemented for this store",
          );
        }

        for (;;) {
          const { aggregateIds, nextCursor } =
            await this.eventStore.listAggregateIds(
              safeOptions.eventStoreContext,
              cursor,
              batchSize,
            );

          if (!aggregateIds.length) {
            cursor = void 0;
            break;
          }

          for (const aggregateId of aggregateIds) {
            // Rebuild projection for each aggregate using existing pipeline.
            await this.rebuildProjection(aggregateId, {
              eventStoreContext: safeOptions.eventStoreContext,
              projectionStoreContext: safeOptions.projectionStoreContext,
            });

            processedCount += 1;
            lastAggregateId = aggregateId;

            const checkpoint: BulkRebuildCheckpoint<AggregateId> = {
              cursor: nextCursor,
              lastAggregateId,
              processedCount,
            };

            if (safeOptions.onProgress) {
              await safeOptions.onProgress({ checkpoint });
            }
          }

          cursor = nextCursor;

          if (!cursor) {
            break;
          }
        }

        const finalCheckpoint: BulkRebuildCheckpoint<AggregateId> = {
          cursor,
          lastAggregateId,
          processedCount,
        };

        span.setAttributes({
          "rebuild.processed_count": processedCount,
          "rebuild.last_aggregate_id":
            typeof lastAggregateId === "string"
              ? lastAggregateId
              : lastAggregateId !== void 0
                ? String(lastAggregateId)
                : void 0,
        });

        return finalCheckpoint;
      },
    );
  }

  private createEventStream(
    aggregateId: AggregateId,
    events: readonly EventType[],
  ): EventStream<AggregateId, EventType> {
    return EventUtils.createEventStream(
      aggregateId,
      events,
      this.options.ordering ?? "timestamp",
    );
  }
}
