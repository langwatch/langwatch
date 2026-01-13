import type { Projection } from "../../../library";
import { BaseMemoryProjectionStore } from "./baseMemoryRepository";
import type { TraceSummaryRepository } from "./traceSummaryRepository";

/**
 * In-memory repository for trace summaries.
 * Useful for testing and development.
 */
export class TraceSummaryRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements TraceSummaryRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
