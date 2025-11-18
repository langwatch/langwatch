import type { Event, Projection } from "../core/types";
import type { AggregateType } from "../core/aggregateType";
import type { EventStoreReadContext } from "../stores/eventStore.types";
import type { ProjectionStoreReadContext } from "../stores/projectionStore.types";
import type {
  BulkRebuildCheckpoint,
  CheckpointStore,
} from "../stores/bulkRebuildCheckpoint";
import type { EventSourcingService } from "./eventSourcingService";
import type { BulkRebuildOptions } from "./eventSourcingService.types";
import type { TenantId } from "../core/tenantId";

export interface BulkRebuildWithCheckpointOptions<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  /**
   * Tenant identifier for the rebuild operation.
   */
  tenantId: TenantId;
  /**
   * Aggregate type label used for checkpoint partitioning.
   * Example: "trace", "evaluation".
   */
  aggregateType: AggregateType;
  /**
   * Maximum number of aggregates to process per batch.
   */
  batchSize?: number;
  /**
   * When true, attempts to resume from a previously stored checkpoint.
   */
  resumeFromCheckpoint?: boolean;
  /**
   * Event store read context, typically including tenantId.
   */
  eventStoreContext: EventStoreReadContext<AggregateId, EventType>;
  /**
   * Projection store context, typically including tenantId.
   */
  projectionStoreContext: ProjectionStoreReadContext;
}

export interface BulkRebuildWithCheckpointDependencies<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  eventSourcingService: EventSourcingService<
    AggregateId,
    EventType,
    ProjectionType
  >;
  checkpointStore: CheckpointStore<AggregateId>;
  /**
   * Optional callback invoked after each aggregate is processed.
   * Can be used by domain services for logging or metrics.
   */
  onProgress?: (progress: {
    checkpoint: BulkRebuildCheckpoint<AggregateId>;
  }) => Promise<void> | void;
}

/**
 * Generic helper that wires EventSourcingService batch rebuilds with a
 * CheckpointStore to support resumable bulk rebuilds.
 *
 * Domain-specific services (like trace bulk rebuild) should wrap this helper
 * to add logging, tracing, and domain-specific semantics.
 */
export async function runBulkRebuildWithCheckpoint<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
>(
  deps: BulkRebuildWithCheckpointDependencies<
    AggregateId,
    EventType,
    ProjectionType
  >,
  options: BulkRebuildWithCheckpointOptions<AggregateId, EventType>,
): Promise<BulkRebuildCheckpoint<AggregateId>> {
  const {
    tenantId,
    aggregateType,
    batchSize,
    resumeFromCheckpoint,
    eventStoreContext,
    projectionStoreContext,
  } = options;

  let resumeFrom: BulkRebuildCheckpoint<AggregateId> | undefined = void 0;

  if (resumeFromCheckpoint) {
    const checkpoint = await deps.checkpointStore.loadCheckpoint(
      tenantId,
      aggregateType,
    );

    if (checkpoint) {
      resumeFrom = checkpoint;
    }
  }

  const bulkOptions: BulkRebuildOptions<AggregateId, EventType> = {
    batchSize,
    eventStoreContext,
    projectionStoreContext,
    resumeFrom,
    onProgress: async (progress) => {
      await deps.checkpointStore.saveCheckpoint(
        tenantId,
        aggregateType,
        progress.checkpoint,
      );

      if (deps.onProgress) {
        await deps.onProgress(progress);
      }
    },
  };

  try {
    const finalCheckpoint =
      await deps.eventSourcingService.rebuildProjectionsInBatches(bulkOptions);

    await deps.checkpointStore.clearCheckpoint(tenantId, aggregateType);

    return finalCheckpoint;
  } catch (error) {
    // Clear checkpoint on error to allow retry from beginning
    await deps.checkpointStore.clearCheckpoint(tenantId, aggregateType);
    throw error;
  }
}
