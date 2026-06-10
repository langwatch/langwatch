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
    if (!hasPersistableSignal(state)) return;
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
    return await this.repo.findByTraceId(
      String(context.tenantId),
      aggregateId,
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
