import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { EvaluationStateRepository } from "./evaluationState.repository";

/**
 * Base class for in-memory projection stores.
 */
abstract class BaseMemoryProjectionStore<T extends Projection = Projection>
  implements ProjectionStore<T>
{
  protected readonly store = new Map<string, T>();

  protected abstract getKey(tenantId: string, aggregateId: string): string;

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<T | null> {
    const key = this.getKey(context.tenantId, aggregateId);
    return this.store.get(key) ?? null;
  }

  async storeProjection(
    projection: T,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    const key = this.getKey(context.tenantId, projection.aggregateId);
    this.store.set(key, projection);
  }
}

/**
 * In-memory repository for evaluation states.
 * Useful for testing and development.
 */
export class EvaluationStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements EvaluationStateRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  async storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    for (const projection of projections) {
      await this.storeProjection(projection, context);
    }
  }
}
