import type {
  FoldProjectionStore,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

/**
 * Thin FoldProjectionStore adapter for evaluation runs.
 * Delegates directly to the canonical Evaluation capability (no mapper needed
 * — projection uses camelCase types).
 */
export class EvaluationRunStore
  implements FoldProjectionStore<EvaluationRunData>
{
  constructor(private readonly service: EvaluationService) {}

  async store(
    state: EvaluationRunData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const stateWithId = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.service.upsertRun({
      data: stateWithId,
      tenantId: String(context.tenantId),
      retentionDays,
    });
  }

  async storeBatch(
    entries: Array<{
      state: EvaluationRunData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const batchEntries = entries.map(({ state, context }) => ({
      data: state.evaluationId
        ? state
        : { ...state, evaluationId: String(context.aggregateId) },
      tenantId: String(context.tenantId),
      retentionDays:
        context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    }));

    await this.service.upsertRuns(batchEntries);
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<EvaluationRunData | null> {
    return await this.service.tryGetRunByEvaluationId({
      tenantId: String(context.tenantId),
      evaluationId: aggregateId,
    });
  }
}
