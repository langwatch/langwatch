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
    await Promise.all(
      entries.map(({ state, context }) =>
        this.repo.upsert(state, String(context.tenantId)),
      ),
    );
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
