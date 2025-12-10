import type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { SpanStorageProjection } from "./spanStorageProjection";

/**
 * In-memory store for span storage projections.
 *
 * The span storage projection tracks which spans have been stored,
 * but the actual span data lives in ClickHouse. This projection
 * state is ephemeral and rebuilt from events on restart.
 */
class SpanStorageProjectionRepositoryMemory
  implements ProjectionStore<SpanStorageProjection>
{
  private readonly projections = new Map<string, SpanStorageProjection>();

  private getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<SpanStorageProjection | null> {
    const key = this.getKey(context.tenantId, aggregateId);
    return this.projections.get(key) ?? null;
  }

  async storeProjection(
    projection: SpanStorageProjection,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    const key = this.getKey(context.tenantId, projection.aggregateId);
    this.projections.set(key, projection);
  }
}

/**
 * Singleton instance of the span storage projection repository.
 */
export const spanStorageProjectionRepository =
  new SpanStorageProjectionRepositoryMemory();
