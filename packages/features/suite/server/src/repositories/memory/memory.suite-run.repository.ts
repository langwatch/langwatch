import type { Projection, ProjectionStoreWriteContext } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type {
  SuiteBatchHistoryInput,
  SuiteRunStateData,
  SuiteRunStateInput,
} from "@langwatch/suite-contract";
import { SuiteRunReadRepository } from "../suite-run.repository";

/** Eventing's no-ClickHouse store; service reads intentionally remain empty. */
export class MemorySuiteRunRepository
  extends BaseMemoryProjectionStore<Projection<SuiteRunStateData>>
  implements SuiteRunReadRepository
{
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

  async getSuiteRunState(_input: SuiteRunStateInput): Promise<SuiteRunStateData | null> {
    return null;
  }

  async getBatchHistory(_input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]> {
    return [];
  }
}
