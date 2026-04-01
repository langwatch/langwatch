import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";

/**
 * Thin FoldProjectionStore adapter for trace summaries.
 * Delegates directly to TraceSummaryRepository (no mapper needed — projection uses camelCase types).
 */
export class TraceSummaryStore
  implements FoldProjectionStore<TraceSummaryData>
{
  constructor(private readonly repo: TraceSummaryRepository) {}

  async store(
    state: TraceSummaryData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (state.spanCount === 0) return;
    const stateWithId = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    await this.repo.upsert(stateWithId, String(context.tenantId));
  }

  async storeBatch(
    entries: Array<{ state: TraceSummaryData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    await Promise.all(
      entries.map(({ state, context }) => this.store(state, context)),
    );
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceSummaryData | null> {
    return await this.repo.getByTraceId(
      String(context.tenantId),
      aggregateId,
    );
  }
}
