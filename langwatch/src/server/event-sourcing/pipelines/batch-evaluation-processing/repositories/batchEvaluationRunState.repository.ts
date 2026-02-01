import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";

/**
 * Repository interface for batch evaluation run state storage operations.
 * Stores computed run state matching the batch_evaluation_runs ClickHouse schema.
 */
export interface BatchEvaluationRunStateRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  /**
   * Retrieves a projection for a given run (aggregateId is the runId).
   * Returns the full projection data including current state.
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores or updates a projection with run state data.
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
