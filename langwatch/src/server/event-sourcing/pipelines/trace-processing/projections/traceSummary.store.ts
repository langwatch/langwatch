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

  /**
   * Persists a single trace summary. Skips empty traces (spanCount 0) and
   * backfills the traceId from the aggregate id when the state omits it.
   */
  async store(
    state: TraceSummaryData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.upsert(stateWithId, String(context.tenantId), retentionDays);
  }

  /**
   * Persists many trace summaries in one round-trip. Empty traces are dropped
   * and the repository's batch upsert is used when available, falling back to
   * per-entry upserts otherwise.
   */
  async storeBatch(
    entries: Array<{ state: TraceSummaryData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const batchEntries = entries
      .filter(({ state }) => hasPersistableSignal(state))
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

/**
 * A fold state is worth persisting when it has at least one span OR at
 * least one log record received. Without this, logs-only traces (claude
 * Path B + OTEL_LOGS_EXPORTER without a traces exporter, codex Path B
 * pre-codex-spans, custom gen_ai-on-logs emitters) accumulate state but
 * never reach trace_summaries — handleTraceLogRecordReceived increments
 * langwatch.reserved.log_record_count but spanCount stays 0.
 */
function hasPersistableSignal(state: TraceSummaryData): boolean {
  if (state.spanCount > 0) return true;
  const raw = state.attributes?.["langwatch.reserved.log_record_count"];
  return typeof raw === "string" && Number(raw) > 0;
}
