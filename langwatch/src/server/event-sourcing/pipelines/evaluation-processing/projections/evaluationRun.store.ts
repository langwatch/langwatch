import type { EvaluationRunRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.repository";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";

/**
 * Thin FoldProjectionStore adapter for evaluation runs.
 * Delegates directly to EvaluationRunRepository (no mapper needed — projection uses camelCase types).
 */
export class EvaluationRunStore
  implements FoldProjectionStore<EvaluationRunData>
{
  constructor(private readonly repo: EvaluationRunRepository) {}

  async store(
    state: EvaluationRunData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const stateWithId = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    await this.repo.upsert(stateWithId, String(context.tenantId));
  }

  async storeBatch(
    entries: Array<{ state: EvaluationRunData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const batchEntries = entries.map(({ state, context }) => ({
      data: state.evaluationId
        ? state
        : { ...state, evaluationId: String(context.aggregateId) },
      tenantId: String(context.tenantId),
    }));

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchEntries);
    } else {
      await Promise.all(
        batchEntries.map(({ data, tenantId }) =>
          this.repo.upsert(data, tenantId),
        ),
      );
    }
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<EvaluationRunData | null> {
    return await this.repo.getByEvaluationId(
      String(context.tenantId),
      aggregateId,
    );
  }
}
