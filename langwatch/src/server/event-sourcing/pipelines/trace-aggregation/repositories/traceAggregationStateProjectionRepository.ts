import type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { Projection } from "../../../library";

/**
 * Repository interface for trace projection storage operations.
 * Stores computed trace metrics matching the trace_projections ClickHouse schema,
 * including all aggregated trace data and computed metrics.
 */
export interface TraceAggregationStateProjectionRepository<
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
}
