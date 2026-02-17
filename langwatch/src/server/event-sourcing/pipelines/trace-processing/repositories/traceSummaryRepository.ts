import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";

/**
 * Repository interface for trace summary storage operations.
 * Stores computed trace metrics matching the trace_summaries ClickHouse schema.
 */
export interface TraceSummaryRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  /**
   * Retrieves a projection for a given trace (aggregateId is the traceId).
   * Returns the full projection data including all computed trace metrics.
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores or updates a projection with full trace metrics data.
   * The projection includes all computed metrics from trace aggregation.
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;

  /**
   * Stores multiple projections in a single operation.
   * ClickHouse: single INSERT (1 part instead of N). Memory: loops.
   */
  storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
