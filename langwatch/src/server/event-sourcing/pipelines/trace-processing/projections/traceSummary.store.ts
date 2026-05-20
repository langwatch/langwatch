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
    const retentionDays = context.retentionPolicy?.traces ?? 0;
    await this.repo.upsert(stateWithId, String(context.tenantId), retentionDays);
  }

  async storeBatch(
    entries: Array<{ state: TraceSummaryData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const batchEntries = entries
      .filter(({ state }) => state.spanCount > 0)
      .map(({ state, context }) => ({
        data: state.traceId
          ? state
          : { ...state, traceId: String(context.aggregateId) },
        tenantId: String(context.tenantId),
        retentionDays: context.retentionPolicy?.traces ?? 0,
      }));

    if (batchEntries.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchEntries);
    } else {
      await Promise.all(
        batchEntries.map(({ data, tenantId, retentionDays }) =>
          this.repo.upsert(data, tenantId, retentionDays),
        ),
      );
    }
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceSummaryData | null> {
    return await this.repo.findByTraceId(
      String(context.tenantId),
      aggregateId,
    );
  }
}
