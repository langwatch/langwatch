import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "@langwatch/eventing";

export abstract class ExperimentRunStateRepository<
  ProjectionType extends Projection = Projection,
> implements ProjectionStore<ProjectionType> {
  abstract tryGetProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  abstract storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;

  abstract storeProjectionBatch?(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
