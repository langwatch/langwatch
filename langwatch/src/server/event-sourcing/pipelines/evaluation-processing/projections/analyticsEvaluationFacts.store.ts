import type { AnalyticsEvaluationFactsRepository } from "~/server/app-layer/analytics/repositories/analytics-evaluation-facts.repository";
import type { AnalyticsEvaluationFactData } from "~/server/app-layer/analytics/types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";

/**
 * Thin FoldProjectionStore adapter for analytics evaluation facts.
 * Delegates directly to AnalyticsEvaluationFactsRepository.
 */
export class AnalyticsEvaluationFactsStore
  implements FoldProjectionStore<AnalyticsEvaluationFactData>
{
  constructor(private readonly repo: AnalyticsEvaluationFactsRepository) {}

  async store(
    state: AnalyticsEvaluationFactData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const stateWithId = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    await this.repo.upsert(stateWithId, String(context.tenantId));
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<AnalyticsEvaluationFactData | null> {
    return await this.repo.getByEvaluationId(
      String(context.tenantId),
      aggregateId,
    );
  }
}
