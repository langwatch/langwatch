import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
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
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
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
        retentionDays:
          context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
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
    // When the executor knows the processed event's occurredAt, pass it as a
    // partition-prune hint: trace_summaries is partitioned by toYearWeek
    // (OccurredAt) and this read otherwise has no time predicate, so it
    // cold-scans every partition (incl. S3 tier). findByTraceId narrows to a
    // ±2-day window around the hint and falls back to an unbounded read if the
    // window misses, so correctness is unchanged.
    return await this.repo.findByTraceId(
      String(context.tenantId),
      aggregateId,
      context.occurredAtMs !== undefined
        ? { occurredAtMs: context.occurredAtMs }
        : undefined,
    );
  }
}
