import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { EventStream } from "../core/eventStream";
import type { Event, Projection } from "../core/types";
import type { EventStoreListCursor } from "../stores/eventStore.types";
import type { BulkRebuildCheckpoint } from "../stores/bulkRebuildCheckpoint";
import { EventUtils } from "../utils/event.utils";
import type { Logger } from "pino";
import {
  DEFAULT_REBUILD_BATCH_SIZE,
  DEFAULT_REBUILD_LOCK_TTL_MS,
} from "./eventSourcingService.types";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
  RebuildProjectionOptions,
  BulkRebuildOptions,
} from "./eventSourcingService.types";
import type { AggregateType } from "../core/aggregateType";
import type { EventStore } from "../stores/eventStore.types";
import type { ProjectionStore } from "../stores/projectionStore.types";
import type { EventHandler } from "../processing/eventHandler";
import type { DistributedLock } from "../utils/distributedLock";
import type { EventStoreReadContext } from "../";


/**
 * Main service that orchestrates event sourcing.
 * Coordinates between event stores, projection stores, and event handlers.
 */
export class EventSourcingService<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-sourcing-service",
  );
  private readonly logger?: Logger;

  private readonly aggregateType: AggregateType;
  private readonly eventStore: EventStore<AggregateId, EventType>;
  private readonly projectionStore: ProjectionStore<
    AggregateId,
    ProjectionType
  >;
  private readonly eventHandler: EventHandler<
    AggregateId,
    EventType,
    ProjectionType
  >;
  private readonly options: EventSourcingOptions<AggregateId, EventType>;
  private readonly distributedLock?: DistributedLock;
  private readonly rebuildLockTtlMs: number;

  constructor({
    aggregateType,
    eventStore,
    projectionStore,
    eventHandler,
    serviceOptions,
    logger,
    distributedLock,
    rebuildLockTtlMs = DEFAULT_REBUILD_LOCK_TTL_MS,
  }: EventSourcingServiceOptions<AggregateId, EventType, ProjectionType>) {
    this.aggregateType = aggregateType;
    this.eventStore = eventStore;
    this.projectionStore = projectionStore;
    this.eventHandler = eventHandler;
    this.options = serviceOptions ?? {};
    this.logger = logger;
    this.distributedLock = distributedLock;
    this.rebuildLockTtlMs = rebuildLockTtlMs;

    // Warn in production if distributed lock is not provided
    if (process.env.NODE_ENV === "production" && !distributedLock && logger) {
      logger.warn(
        {
          aggregateType,
        },
        "[SECURITY] EventSourcingService initialized without distributed lock in production. Concurrent rebuilds of the same aggregate may result in lost updates (last write wins). Consider providing a DistributedLock implementation.",
      );
    }
  }

  /**
   * Stores events using the pipeline's aggregate type.
   * This method automatically uses the aggregate type configured for this pipeline,
   * preventing copy/paste mistakes where the wrong aggregate type is passed.
   *
   * @param events - Events to store
   * @param context - Security context with required tenantId
   */
  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<AggregateId, EventType>,
  ): Promise<void> {
    return await this.eventStore.storeEvents(
      events,
      context,
      this.aggregateType,
    );
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
          "tenant.id": options?.eventStoreContext?.tenantId ?? "missing",
        },
      },
      async (span) => {
        if (options?.eventStoreContext) {
          EventUtils.validateTenantId(
            options.eventStoreContext,
            "rebuildProjection",
          );
        } else {
          throw new Error(
            "[SECURITY] rebuildProjection requires eventStoreContext with tenantId for tenant isolation",
          );
        }

        // Acquire distributed lock to prevent concurrent rebuilds. The queue should help with this,
        // but better safe than sorry.
        const lockKey = `rebuild:${options.eventStoreContext.tenantId}:${this.aggregateType}:${String(aggregateId)}`;
        const lockHandle = this.distributedLock
          ? await this.distributedLock.acquire(lockKey, this.rebuildLockTtlMs)
          : null;

        if (this.distributedLock && !lockHandle) {
          const error = new Error(
            `[CONCURRENCY] Cannot acquire lock for rebuilding aggregate ${String(aggregateId)}. Another rebuild may be in progress.`,
          );
          this.logger?.warn(
            {
              aggregateId: String(aggregateId),
              tenantId: options.eventStoreContext.tenantId,
              lockKey,
            },
            "Failed to acquire rebuild lock - concurrent rebuild in progress",
          );
          throw error;
        }

        try {
          const startTime = Date.now();

          this.logger?.info(
            {
              aggregateId: String(aggregateId),
              tenantId: options.eventStoreContext.tenantId,
            },
            "Starting projection rebuild",
          );

          span.addEvent("event_store.fetch.start");
          const events = await this.eventStore.getEvents(
            aggregateId,
            options.eventStoreContext,
            this.aggregateType,
          );
          span.addEvent("event_store.fetch.complete");

          const stream = this.createEventStream(aggregateId, events);
          const metadata = EventUtils.buildProjectionMetadata(stream);

          span.setAttributes({
            "event.count": metadata.eventCount,
            "event.first_timestamp": metadata.firstEventTimestamp ?? void 0,
            "event.last_timestamp": metadata.lastEventTimestamp ?? void 0,
          });

          this.logger?.debug(
            {
              aggregateId: String(aggregateId),
              eventCount: metadata.eventCount,
            },
            "Loaded events for projection rebuild",
          );

          if (this.options.hooks?.beforeHandle) {
            span.addEvent("hook.before_handle.start");
            await this.options.hooks.beforeHandle(stream, metadata);
            span.addEvent("hook.before_handle.complete");
          }

          span.addEvent("event_handler.handle.start");
          const projection = await this.eventHandler.handle(stream);
          span.addEvent("event_handler.handle.complete");

          span.setAttributes({
            "projection.id": projection.id,
            "projection.version": projection.version,
          });

          if (this.options.hooks?.afterHandle) {
            span.addEvent("hook.after_handle.start");
            await this.options.hooks.afterHandle(stream, projection, metadata);
            span.addEvent("hook.after_handle.complete");
          }

          if (this.options.hooks?.beforePersist) {
            span.addEvent("hook.before_persist.start");
            await this.options.hooks.beforePersist(projection, metadata);
            span.addEvent("hook.before_persist.complete");
          }

          const projectionContext =
            options?.projectionStoreContext ?? options?.eventStoreContext;
          if (!projectionContext) {
            throw new Error(
              "[SECURITY] rebuildProjection requires context with tenantId for tenant isolation",
            );
          }
          EventUtils.validateTenantId(projectionContext, "rebuildProjection");

          span.addEvent("projection_store.store.start");
          await this.projectionStore.storeProjection(
            projection,
            projectionContext,
          );
          span.addEvent("projection_store.store.complete");

          if (this.options.hooks?.afterPersist) {
            span.addEvent("hook.after_persist.start");
            await this.options.hooks.afterPersist(projection, metadata);
            span.addEvent("hook.after_persist.complete");
          }

          const durationMs = Date.now() - startTime;

          this.logger?.info(
            {
              aggregateId: String(aggregateId),
              projectionId: projection.id,
              projectionVersion: projection.version,
              eventCount: metadata.eventCount,
              durationMs,
            },
            "Projection rebuild completed",
          );

          return projection;
        } finally {
          // Release lock if we acquired it
          if (lockHandle && this.distributedLock) {
            try {
              await this.distributedLock.release(lockHandle);
            } catch (error) {
              this.logger?.error(
                {
                  aggregateId: String(aggregateId),
                  tenantId: options.eventStoreContext.tenantId,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to release rebuild lock",
              );
              // Don't throw - lock will expire naturally
            }
          }
        }
      },
    );
  }

  /**
   * Gets the current projection for an aggregate, rebuilding if necessary.
   * @param aggregateId - The aggregate to get projection for
   * @param options - Options including context with tenantId
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
        const projectionContext =
          options?.projectionStoreContext ?? options?.eventStoreContext;
        if (!projectionContext) {
          throw new Error(
            "[SECURITY] getProjection requires context with tenantId for tenant isolation",
          );
        }
        EventUtils.validateTenantId(projectionContext, "getProjection");

        let projection = await this.projectionStore.getProjection(
          aggregateId,
          projectionContext,
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
   * @param options - Options including projection store context with tenantId
   * @returns True if projection exists
   */
  async hasProjection(
    aggregateId: AggregateId,
    options?: RebuildProjectionOptions<AggregateId, EventType>,
  ): Promise<boolean> {
    const context =
      options?.projectionStoreContext ?? options?.eventStoreContext;
    if (!context) {
      throw new Error(
        "[SECURITY] hasProjection requires context with tenantId for tenant isolation",
      );
    }
    EventUtils.validateTenantId(context, "hasProjection");
    const projection = await this.projectionStore.getProjection(
      aggregateId,
      context,
    );
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
    options: BulkRebuildOptions<AggregateId, EventType>,
  ): Promise<BulkRebuildCheckpoint<AggregateId>> {
    const safeOptions = options;
    const batchSize =
      safeOptions.batchSize && safeOptions.batchSize > 0
        ? safeOptions.batchSize
        : DEFAULT_REBUILD_BATCH_SIZE;

    return await this.tracer.withActiveSpan(
      "EventSourcingService.rebuildProjectionsInBatches",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "batch.size": batchSize,
          "tenant.id": safeOptions.eventStoreContext?.tenantId ?? "missing",
        },
      },
      async (span) => {
        let processedCount = safeOptions.resumeFrom?.processedCount ?? 0;
        let cursor: EventStoreListCursor | undefined =
          safeOptions.resumeFrom?.cursor;
        let lastAggregateId: AggregateId | undefined =
          safeOptions.resumeFrom?.lastAggregateId;

        this.logger?.info(
          {
            batchSize,
            resumedFromCount: safeOptions.resumeFrom?.processedCount,
            cursor: safeOptions.resumeFrom?.cursor,
            tenantId: safeOptions.eventStoreContext?.tenantId ?? "missing",
          },
          "Starting batch rebuild",
        );

        // Loop until the event store indicates there are no more aggregate IDs.
        // This method is deliberately conservative: callers can chunk work further
        // at a higher level if they want finer-grained jobs.
        if (!this.eventStore.listAggregateIds) {
          const error = new Error(
            "EventStore.listAggregateIds is not implemented for this store",
          );
          this.logger?.error(
            { error: error.message },
            "Cannot perform batch rebuild: listAggregateIds not implemented",
          );
          throw error;
        }

        if (!safeOptions.eventStoreContext) {
          throw new Error(
            "[SECURITY] rebuildProjectionsInBatches requires eventStoreContext with tenantId for tenant isolation",
          );
        }
        EventUtils.validateTenantId(
          safeOptions.eventStoreContext,
          "rebuildProjectionsInBatches",
        );

        for (;;) {
          const { aggregateIds, nextCursor } =
            await this.eventStore.listAggregateIds(
              safeOptions.eventStoreContext,
              this.aggregateType,
              cursor,
              batchSize,
            );

          if (!aggregateIds.length) {
            cursor = void 0;
            this.logger?.debug(
              { processedCount },
              "No more aggregates to process",
            );
            break;
          }

          this.logger?.debug(
            {
              batchAggregateCount: aggregateIds.length,
              processedCount,
              cursor,
            },
            "Processing batch of aggregates",
          );

          for (const aggregateId of aggregateIds) {
            try {
              // Rebuild projection for each aggregate using existing pipeline.
              await this.rebuildProjection(aggregateId, {
                eventStoreContext: safeOptions.eventStoreContext,
                projectionStoreContext: safeOptions.projectionStoreContext,
              });

              processedCount += 1;
              lastAggregateId = aggregateId;

              // Log progress every 100 aggregates
              if (processedCount % 100 === 0) {
                this.logger?.info(
                  {
                    processedCount,
                    lastAggregateId: String(aggregateId),
                    cursor: nextCursor,
                  },
                  "Batch rebuild progress",
                );
              }

              const checkpoint: BulkRebuildCheckpoint<AggregateId> = {
                cursor: nextCursor,
                lastAggregateId,
                processedCount,
              };

              if (safeOptions.onProgress) {
                await safeOptions.onProgress({ checkpoint });
              }
            } catch (error) {
              // CURRENT: Fail-fast error handling
              // When a single aggregate fails, we halt the entire batch operation.
              // This ensures strict correctness and prevents partial state.
              //
              // FUTURE IMPROVEMENT: Consider implementing graceful degradation:
              // - Collect per-aggregate errors instead of throwing immediately
              // - Continue processing remaining aggregates in the batch
              // - Return both the checkpoint and collected errors
              // - Benefits: Better throughput, one bad aggregate doesn't block all others
              // - Trade-offs: More complex error reporting, partial success states
              //
              // For now, callers can use resumeFrom to retry failed batches.
              this.logger?.error(
                {
                  aggregateId: String(aggregateId),
                  tenantId: safeOptions.eventStoreContext.tenantId,
                  aggregateType: this.aggregateType,
                  processedCount,
                  cursor: nextCursor,
                  lastAggregateId: lastAggregateId
                    ? String(lastAggregateId)
                    : void 0,
                  error: error instanceof Error ? error.message : String(error),
                  errorStack: error instanceof Error ? error.stack : void 0,
                  errorName: error instanceof Error ? error.name : void 0,
                },
                "Failed to rebuild projection for aggregate in batch",
              );
              throw error;
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

        this.logger?.info(
          {
            processedCount,
            lastAggregateId: lastAggregateId ? String(lastAggregateId) : void 0,
          },
          "Batch rebuild completed",
        );

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
