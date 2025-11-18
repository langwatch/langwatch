import type { EventStream } from "../core/eventStream";
import type {
  Event,
  EventOrderingStrategy,
  Projection,
  ProjectionMetadata,
} from "../core/types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../stores/eventStore.types";
import type { AggregateType } from "../core/aggregateType";
import type {
  ProjectionStore,
  ProjectionStoreReadContext,
} from "../stores/projectionStore.types";
import type { EventHandler } from "../processing/eventHandler";
import type { BulkRebuildCheckpoint } from "../stores/bulkRebuildCheckpoint";
import type { Logger } from "pino";
import type { DistributedLock } from "../utils/distributedLock";

export const DEFAULT_REBUILD_BATCH_SIZE = 100;
export const DEFAULT_REBUILD_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Hooks for extending the event sourcing pipeline.
 *
 * **Execution Order:** beforeHandle → handle → afterHandle → beforePersist → persist → afterPersist
 *
 * **Error Handling:**
 * - If beforeHandle throws: handler is not called, no persistence occurs
 * - If handler throws: afterHandle/beforePersist/persist/afterPersist are not called
 * - If afterHandle throws: projection is not persisted
 * - If beforePersist throws: projection is not persisted
 * - If persist fails: afterPersist is not called
 * - If afterPersist throws: projection WAS persisted (partial success state)
 *
 * **Concurrency Note:** Hooks are called sequentially, not concurrently.
 * Each hook completes before the next begins.
 *
 * **Best Practices:**
 * - Keep hooks fast and focused
 * - Avoid side effects in beforePersist/afterPersist that can't be rolled back
 * - Consider implementing compensating transactions if afterPersist can fail
 * - Don't throw in afterPersist unless you need to signal an error
 */
export interface EventSourcingHooks<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  /**
   * Called before the event handler processes the stream.
   * Use for validation, logging, or preparation.
   * Throwing here prevents handler execution.
   */
  beforeHandle?(
    stream: EventStream<AggregateId, EventType>,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
  /**
   * Called after the event handler produces a projection, before persistence.
   * Use for validation, enrichment, or logging.
   * Throwing here prevents persistence.
   */
  afterHandle?(
    stream: EventStream<AggregateId, EventType>,
    projection: ProjectionType,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
  /**
   * Called immediately before persisting the projection.
   * Use for final validation or logging.
   * Throwing here prevents persistence.
   */
  beforePersist?(
    projection: ProjectionType,
    metadata: ProjectionMetadata,
  ): Promise<void> | void;
  /**
   * Called after the projection has been successfully persisted.
   *
   * **WARNING:** The projection IS already persisted when this runs.
   * Throwing here leaves the system in a partial success state.
   * Consider carefully whether errors here should fail the operation.
   */
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
  aggregateType: AggregateType;
  eventStore: EventStore<AggregateId, EventType>;
  projectionStore: ProjectionStore<AggregateId, ProjectionType>;
  eventHandler: EventHandler<AggregateId, EventType, ProjectionType>;
  serviceOptions?: EventSourcingOptions<AggregateId, EventType>;
  logger?: Logger;
  /**
   * Optional distributed lock for preventing concurrent rebuilds of the same aggregate.
   * If not provided, concurrent rebuilds may result in lost updates (last write wins).
   * Recommended for production deployments with multiple workers.
   */
  distributedLock?: DistributedLock;
  /**
   * Time-to-live for rebuild locks in milliseconds.
   * Default: 5 minutes
   */
  rebuildLockTtlMs?: number;
}
