import type {
  FoldProjectionStore,
  ProjectionStoreContext,
  FoldStateRead,
} from "@langwatch/eventing";

import type { TraceAnalyticsProjectionRepository } from "../repositories/projection/trace-analytics-projection.repository.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "./trace-derived.projection.ts";

/**
 * The projection stamps `getWithApplied` will decode: the current shape, and the pre-split
 * shape it can read unambiguously. Everything older is a store miss.
 */
const DECODABLE_PROJECTION_VERSIONS: ReadonlySet<string> = new Set([
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
]);

/**
 * FoldProjectionStore adapter for the slim trace_analytics fold (ADR-034
 * Phase 2, read-back per ADR-066). `get`/`getWithApplied` decode the last
 * committed row instead of refolding from `event_log`.
 */
export class TraceAnalyticsStore implements FoldProjectionStore<TraceAnalyticsData> {
  private constructor(
    private readonly storage: TraceAnalyticsProjectionRepository,
    private readonly defaultRetentionDays: () => number,
  ) {}

  static create(options: {
    storage: TraceAnalyticsProjectionRepository;
    defaultRetentionDays: () => number;
  }): TraceAnalyticsStore {
    return new TraceAnalyticsStore(options.storage, options.defaultRetentionDays);
  }

  async store(state: TraceAnalyticsData, context: ProjectionStoreContext): Promise<void> {
    const entry = this.toRow(state, context);
    if (!entry) return;
    await this.storage.upsert(entry);
  }

  async storeBatch(
    entries: {
      state: TraceAnalyticsData;
      context: ProjectionStoreContext;
    }[],
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
      retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays(),
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds ? [...context.appliedEventIds] : [],
    };
  }

  /**
   * Reads the trace's last committed slim state with its applied-event-id
   * watermark (ADR-066). An older version reports a MISS rather than
   * decoding stale defaults, except the pre-split stamp (ADR-071).
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: TraceAnalyticsData | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.storage.findByTraceId({
      tenantId: String(context.tenantId),
      traceId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [], miss: "absent" };
    // Stale schema snapshot: read-back columns didn't exist when this row was
    // written, so decoding would fabricate state. Reported `undecodable`, not
    // `absent`, so the executor won't retry an unwindowed re-read.
    if (!DECODABLE_PROJECTION_VERSIONS.has(found.row.version)) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceAnalyticsData>> {
    const { state } = await this.getWithApplied(aggregateId, context);
    return state === null ? { kind: "empty" } : { kind: "folded", state };
  }
}
