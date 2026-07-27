import type { TraceAnalyticsRepository } from "~/server/app-layer/traces/repositories/trace-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  traceAnalyticsStateFromRow,
} from "./traceAnalytics.foldProjection";

/**
 * FoldProjectionStore adapter for the slim trace_analytics fold (ADR-034
 * Phase 2, read-back per ADR-066). Mirrors the trace-summary store's shape —
 * skip empty traces, fall back to the aggregateId when the state has no
 * traceId, stamp the per-tenant retention onto the record — and projects the
 * in-memory `TraceAnalyticsData` accumulator into the slim row at write time.
 *
 * The slim row is derived deterministically from a fold state whose handlers
 * call the same SERVICE CLASSES the trace-summary fold uses, so the persisted
 * Hoisted Dims columns (TotalCost, TimeToFirstTokenMs, Models, TopicId, Origin,
 * …) match trace_summaries to the cent for the SAME trace. The slim Attributes
 * map is trimmed by `trimAttributesForAnalytics` inside the projection
 * function so payload-shaped keys never reach the wire.
 *
 * Read-back (ADR-066): `get`/`getWithApplied` decode the last committed row
 * (typed read-back columns, migration 00056) so the delivery path never refolds
 * from `event_log`; the applied-event-id watermark rides next to the row so a
 * cold-cache retry still dedups a redelivered batch.
 */
export class TraceAnalyticsStore
  implements FoldProjectionStore<TraceAnalyticsData>
{
  constructor(private readonly repo: TraceAnalyticsRepository) {}

  async store(
    state: TraceAnalyticsData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const entry = this.toRow(state, context);
    if (!entry) return;
    await this.repo.upsert(
      entry.row,
      entry.retentionDays,
      entry.appliedEventIds,
    );
  }

  async storeBatch(
    entries: Array<{
      state: TraceAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .map(({ state, context }) => this.toRow(state, context))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (batchRows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchRows);
    } else {
      await Promise.all(
        batchRows.map(({ row, retentionDays, appliedEventIds }) =>
          this.repo.upsert(row, retentionDays, appliedEventIds),
        ),
      );
    }
  }

  private toRow(
    state: TraceAnalyticsData,
    context: ProjectionStoreContext,
  ): {
    row: ReturnType<typeof projectAnalyticsStateToRow>;
    retentionDays: number;
    appliedEventIds: string[];
  } | null {
    if (!hasPersistableSignal(state)) return null;
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
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds
        ? [...context.appliedEventIds]
        : [],
    };
  }

  /**
   * Read the trace's last committed slim state back together with the
   * applied-event-id watermark (ADR-066) — the CH-fallthrough behind the Redis
   * cache miss. The typed read-back columns (migration 00056) let the trimmed
   * row round-trip the fold's working state — span count, the annotation id
   * set, name-resolution bookkeeping, the checkpoint — without replaying
   * `event_log`.
   *
   * `context.readWindow` — computed by the executor from the fold's declared
   * `options.readWindow` — prunes the read to a window of partitions around the
   * event being folded; it is passed through verbatim. On a windowed miss the
   * EXECUTOR retries without the window, so a row outside it is still found;
   * this store neither widens the window nor implements a fallback itself.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: TraceAnalyticsData | null;
    appliedEventIds: string[];
  }> {
    const found = await this.repo.findByTraceIdWithApplied({
      tenantId: String(context.tenantId),
      traceId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [] };
    return {
      state: traceAnalyticsStateFromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceAnalyticsData | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }
}

/**
 * Same persistable-signal predicate the trace-summary store uses, plus one
 * read-back allowance. Spans-only gating is too strict for log-only emitters
 * (Claude Code Path B, Codex Path B); the trace-summary fold counts log records
 * via langwatch.reserved.log_record_count and we mirror its acceptance.
 *
 * `occurredAt > 0` additionally covers a read-back of a PRE-migration row: such
 * a row has real data but its SpanCount column defaults to 0 (the column did
 * not exist when it was written), so a later dimension-only event (topic /
 * annotation) folded onto it would otherwise be dropped by a spanCount-only
 * gate. A positive occurredAt only ever comes from a real folded span, so this
 * admits exactly that read-back case and never a phantom init state (occurredAt
 * stays 0 until a span lands).
 */
function hasPersistableSignal(state: TraceAnalyticsData): boolean {
  if (state.spanCount > 0) return true;
  if (state.occurredAt > 0) return true;
  const raw = state.attributes?.["langwatch.reserved.log_record_count"];
  return typeof raw === "string" && Number(raw) > 0;
}
