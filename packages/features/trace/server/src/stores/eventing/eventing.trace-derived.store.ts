import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../../projections/trace-derived.projection";
import { TraceAnalyticsProjectionPort } from "../../ports/trace-analytics-projection.port";

/**
 * The projection stamps `getWithApplied` will decode: the current shape, and the pre-split
 * shape it can read unambiguously. Everything older is a store miss.
 */
const DECODABLE_PROJECTION_VERSIONS: ReadonlySet<string> = new Set([
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
]);

/**
 * FoldProjectionStore adapter for the slim trace_analytics fold (ADR-034 Phase 2, read-back
 * per ADR-066). Its Hoisted Dims columns are derived by the same service classes the
 * trace-summary fold uses, so they match trace_summaries to the cent for the same trace.
 * `get`/`getWithApplied` decode the last committed row instead of refolding from `event_log`;
 * decoding is gated on the row's projection version — see `getWithApplied`.
 */
export class TraceAnalyticsStore implements FoldProjectionStore<TraceAnalyticsData> {
  private constructor(
    private readonly storage: TraceAnalyticsProjectionPort,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    storage: TraceAnalyticsProjectionPort;
    defaultRetentionDays: number;
  }): TraceAnalyticsStore {
    return new TraceAnalyticsStore(options.storage, options.defaultRetentionDays);
  }

  async store(state: TraceAnalyticsData, context: ProjectionStoreContext): Promise<void> {
    const entry = this.toRow(state, context);
    if (!entry) return;
    await this.storage.upsert(entry);
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

    await this.storage.upsertBatch(batchRows);
  }

  private toRow(
    state: TraceAnalyticsData,
    context: ProjectionStoreContext,
  ): {
    row: ReturnType<typeof TraceAnalyticsFoldProjection.projectAnalyticsStateToRow>;
    retentionDays: number;
    appliedEventIds: string[];
  } | null {
    // Always writes, including dimension-only states: the "counts as a trace" gate rides on
    // `hasSignal` in SQL (TRACE_ANALYTICS_HAS_SIGNAL_SQL), so the fold read-back always finds
    // its row and the executor can trust an absent read (`trustAbsentMiss`).
    const stateWithId: TraceAnalyticsData = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    return {
      row: TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
        state: stateWithId,
        tenantId: String(context.tenantId),
        version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
      }),
      retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays,
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds ? [...context.appliedEventIds] : [],
    };
  }

  /**
   * Reads the trace's last committed slim state with its applied-event-id watermark (ADR-066).
   * An older projection version reports a MISS rather than decoding stale defaults, and
   * `refoldOnStoreMiss` rebuilds it once — except the pre-split stamp (ADR-071), admitted and
   * decoded directly; see {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: TraceAnalyticsData | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.storage.tryFindByTraceId({
      tenantId: String(context.tenantId),
      traceId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [], miss: "absent" };
    // Stale schema snapshot: the read-back columns did not exist when this row
    // was written, so decoding it would fabricate state. Answer as for "no row"
    // — the watermark is dropped too, because a watermark without the state it
    // belongs to would suppress the very events the re-fold needs — but report
    // it as `undecodable`, not `absent`: the row was FOUND and refused, so the
    // executor must not answer with an unwindowed re-read that can only find
    // the same row again.
    if (!DECODABLE_PROJECTION_VERSIONS.has(found.row.version)) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async tryGet(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceAnalyticsData | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }
}
