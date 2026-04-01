import type { AnalyticsTraceFactsRepository } from "~/server/app-layer/analytics/repositories/analytics-trace-facts.repository";
import type { AnalyticsTraceFactData } from "~/server/app-layer/analytics/types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";

/**
 * Thin FoldProjectionStore adapter for analytics trace facts.
 * Delegates directly to AnalyticsTraceFactsRepository.
 */
export class AnalyticsTraceFactsStore
  implements FoldProjectionStore<AnalyticsTraceFactData>
{
  constructor(private readonly repo: AnalyticsTraceFactsRepository) {}

  async store(
    state: AnalyticsTraceFactData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (state.spanCount === 0) return;
    const stateWithId = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    await this.repo.upsert(stateWithId, String(context.tenantId));
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<AnalyticsTraceFactData | null> {
    return await this.repo.getByTraceId(
      String(context.tenantId),
      aggregateId,
    );
  }
}
