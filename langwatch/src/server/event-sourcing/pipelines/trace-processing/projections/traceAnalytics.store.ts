import type { TraceAnalyticsRepository } from "~/server/app-layer/traces/repositories/trace-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  projectAnalyticsStateToRow,
  type TraceAnalyticsData,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
} from "./traceAnalytics.foldProjection";

/**
 * FoldProjectionStore adapter for the slim trace_analytics fold (ADR-034
 * Phase 2). Mirrors the trace-summary store's shape — skip empty traces, fall
 * back to the aggregateId when the state has no traceId, stamp the per-tenant
 * retention onto the record — and projects the in-memory `TraceAnalyticsData`
 * accumulator into the slim row at write time.
 *
 * The slim row is derived deterministically from a fold state whose handlers
 * call the same SERVICE CLASSES the trace-summary fold uses, so the persisted
 * Hoisted Dims columns (TotalCost, TimeToFirstTokenMs, Models, TopicId, Origin,
 * …) match trace_summaries to the cent for the SAME trace. The slim Attributes
 * map is trimmed by `trimAttributesForAnalytics` inside the projection
 * function so payload-shaped keys never reach the wire.
 */
export class TraceAnalyticsStore
  implements FoldProjectionStore<TraceAnalyticsData>
{
  constructor(private readonly repo: TraceAnalyticsRepository) {}

  async store(
    state: TraceAnalyticsData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId: TraceAnalyticsData = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    const row = projectAnalyticsStateToRow({
      state: stateWithId,
      tenantId: String(context.tenantId),
      version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
    });
    await this.repo.upsert(row, retentionDays);
  }

  async storeBatch(
    entries: Array<{
      state: TraceAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .filter(({ state }) => hasPersistableSignal(state))
      .map(({ state, context }) => {
        const stateWithId: TraceAnalyticsData = state.traceId
          ? state
          : { ...state, traceId: String(context.aggregateId) };
        return {
          row: projectAnalyticsStateToRow({
            state: stateWithId,
            tenantId: String(context.tenantId),
            version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
          }),
          retentionDays:
            context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
        };
      });

    if (batchRows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchRows);
    } else {
      await Promise.all(
        batchRows.map(({ row, retentionDays }) =>
          this.repo.upsert(row, retentionDays),
        ),
      );
    }
  }

  /**
   * The slim table is dual-tap only in Phase 2 — no read path. `get` returns
   * null so the executor always re-folds from the event log when slim needs a
   * cache miss, rather than reading slim back (which would require duplicating
   * the trace-summary read path with the typed-column hoist reversed).
   *
   * Phase 3 will wire `getTimeseries` through a proper slim repository read;
   * this method stays a no-op until then.
   */
  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<TraceAnalyticsData | null> {
    return null;
  }
}

/**
 * Same persistable-signal predicate the trace-summary store uses. Spans-only
 * gating is too strict for log-only emitters (Claude Code Path B, Codex Path
 * B); the trace-summary fold counts log records via
 * langwatch.reserved.log_record_count and we mirror its acceptance.
 */
function hasPersistableSignal(state: TraceAnalyticsData): boolean {
  if (state.spanCount > 0) return true;
  const raw = state.attributes?.["langwatch.reserved.log_record_count"];
  return typeof raw === "string" && Number(raw) > 0;
}
