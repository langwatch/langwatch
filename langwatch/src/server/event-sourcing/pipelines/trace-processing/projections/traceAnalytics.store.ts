import type { TraceAnalyticsRepository } from "~/server/event-sourcing/ports/trace-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
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
   * No read-back, by design: the slim row is lossy (trimmed attributes,
   * booleans instead of arrays), so fold state cannot be reconstructed from
   * it. Returning null here means fold-state continuity comes from the two
   * layers above this store:
   *
   *   1. the RedisCachedFoldStore wrapped around it at registration (serves
   *      the warm path), and
   *   2. the fold's `refoldOnStoreMiss` option (see
   *      TraceAnalyticsFoldProjection.options) — on a cache miss the executor
   *      rebuilds state from the event log up to the delivered event.
   *
   * Without BOTH of those, a null get would make every delivery fold only its
   * own batch — partial rows overwriting complete ones.
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
