import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "@langwatch/eventing";

export abstract class SimulationRunStateRepository<
  ProjectionType extends Projection = Projection,
> implements ProjectionStore<ProjectionType> {
  abstract getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  abstract storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
