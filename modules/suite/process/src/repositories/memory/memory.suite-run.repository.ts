import type { Projection, ProjectionStoreWriteContext } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

// In-memory run projection for testing without ClickHouse.
export class MemorySuiteRunRepository extends BaseMemoryProjectionStore<
  Projection<SuiteRunStateData>
> {
  static create(): MemorySuiteRunRepository {
    return new MemorySuiteRunRepository();
  }

  private constructor() {
    super();
  }

  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  async storeProjectionBatch(
    projections: Projection<SuiteRunStateData>[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    for (const projection of projections) {
      await this.storeProjection(projection, context);
    }
  }
}
