import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";

export interface ExperimentRunStateRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;

  storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
