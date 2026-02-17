import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";

/**
 * Repository interface for evaluation state storage operations.
 * Stores computed evaluation state matching the evaluation_states ClickHouse schema.
 */
export interface EvaluationStateRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  /**
   * Retrieves a projection for a given evaluation (aggregateId is the evaluationId).
   * Returns the full projection data including current state.
   */
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  /**
   * Stores or updates a projection with evaluation state data.
   */
  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;

  storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
