import type { Projection, ProjectionStoreWriteContext } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type {
  SuiteBatchHistoryInput,
  SuiteRunStateData,
  SuiteRunStateInput,
} from "@langwatch/suite-contract";
import { SuiteRunReadRepository } from "../suite-run.repository.ts";

/**
 * The run projection, held in this process.
 *
 * It is a real twin, not a null object: what it is written it answers back,
 * scoped to the tenant that wrote it, so a test can assert on a suite run's
 * progress without a ClickHouse server, and the two reads below tell the same
 * story the live store does. Answering `null` and `[]` regardless of what was
 * written is what let a deployment with no ClickHouse serve an empty run
 * history and look healthy.
 */
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

  /** The latest state of one batch run, or null where none was written. */
  async tryGetSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null> {
    return this.store.get(this.getKey(input.projectId, input.batchRunId))?.data ?? null;
  }

  /**
   * The tenant's runs for one scenario set, newest first.
   *
   * `default` and the empty string name the same set — a run recorded before
   * sets were named carries neither — so a history read for one finds the
   * other, exactly as the live store's `IN` filter does.
   */
  async getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]> {
    const wanted = new Set(
      input.scenarioSetId === "default" || input.scenarioSetId === ""
        ? ["default", ""]
        : [input.scenarioSetId],
    );
    const limit = Math.min(input.limit ?? 50, 100);
    return this.storedFor(input.projectId)
      .filter((state) => wanted.has(state.ScenarioSetId))
      .sort((left, right) => right.CreatedAt - left.CreatedAt)
      .slice(0, limit);
  }

  /** Every projection this process holds for one tenant. */
  private storedFor(tenantId: string): SuiteRunStateData[] {
    const prefix = `${tenantId}:`;
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, projection]) => projection.data);
  }
}
