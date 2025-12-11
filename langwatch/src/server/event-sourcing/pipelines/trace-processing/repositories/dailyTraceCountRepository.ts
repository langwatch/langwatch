import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";

/**
 * Repository interface for daily trace count storage operations.
 * Stores trace counts per day per tenant for usage statistics.
 */
export interface DailyTraceCountRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  /**
   * Retrieves a projection for a given trace (aggregateId is the traceId).
   * Note: For this projection, getProjection returns null as data is aggregated.
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores a projection with trace ID and date for aggregation.
   * Uses ClickHouse's uniqState for idempotent unique counting.
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
