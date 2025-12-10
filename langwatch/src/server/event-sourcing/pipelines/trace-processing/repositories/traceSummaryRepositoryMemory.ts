import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { TraceSummaryRepository } from "./traceSummaryRepository";

/**
 * In-memory repository for trace summaries.
 * Useful for testing and development.
 */
export class TraceSummaryRepositoryMemory<
  ProjectionType extends Projection = Projection,
> implements TraceSummaryRepository<ProjectionType>
{
  private readonly projections = new Map<string, ProjectionType>();

  private getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    const key = this.getKey(context.tenantId, aggregateId);
    return this.projections.get(key) ?? null;
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    const key = this.getKey(context.tenantId, projection.aggregateId);
    this.projections.set(key, projection);
  }
}

