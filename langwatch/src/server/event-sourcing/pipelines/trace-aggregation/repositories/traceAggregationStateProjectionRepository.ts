import type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { Projection } from "../../../library";

/**
 * Repository interface for trace aggregation state projection storage operations.
 * Stores the full projection data including aggregation status and all aggregated trace data
 * (spanIds, totalSpans, serviceNames, etc.) when aggregation is completed.
 */
export interface TraceAggregationStateProjectionRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  /**
   * Retrieves a projection for a given aggregate.
   * Returns the full projection data including all aggregated trace information.
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores or updates a projection with full data.
   * The projection includes aggregation status and all aggregated trace data when completed.
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
