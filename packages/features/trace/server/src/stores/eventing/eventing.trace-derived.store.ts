import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  traceAnalyticsStateFromRow,
} from "../../projections/trace-derived.projection";
import { TraceAnalyticsProjectionPort } from "../../ports/trace-analytics-projection.port";

/**
 * The projection stamps whose rows `getWithApplied` will decode.
 *
 * Two, not one: the current shape, and the pre-split shape the decoder can read
 * without ambiguity. Everything older is a store miss. Adding a member here is a
 * claim that `traceAnalyticsStateFromRow` derives every field correctly from
 * that shape — for the pre-split stamp that claim is discharged by the
 * `occurredAt` branch in the decoder, and nowhere else.
 */
const DECODABLE_PROJECTION_VERSIONS: ReadonlySet<string> = new Set([
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
]);

/**
 * FoldProjectionStore adapter for the slim trace_analytics fold (ADR-034
 * Phase 2, read-back per ADR-066). Mirrors the trace-summary store's shape —
 * fall back to the aggregateId when the state has no
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
 * (typed read-back columns, migration 00056) so the delivery path does not
 * refold from `event_log`; the applied-event-id watermark rides next to the row
 * so a cold-cache retry still dedups a redelivered batch. Decoding is gated on
 * the row's projection version — see `getWithApplied`.
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
    row: ReturnType<typeof projectAnalyticsStateToRow>;
    retentionDays: number;
    appliedEventIds: string[];
  } | null {
    // ALWAYS writes — including dimension-only states, which used to be gated
    // out here. The gate's verdict now rides on the in-memory row as
    // `hasSignal` (stamped inside `projectAnalyticsStateToRow`) and readers
    // derive it in SQL from columns the row already carries
    // (TRACE_ANALYTICS_HAS_SIGNAL_SQL), so the product still never
    // counts a phantom trace, while the fold read-back always finds its row —
    // which is what lets the executor trust an absent read
    // (`trustAbsentMiss`) instead of paying an unwindowed fallback scan plus
    // an `event_log` re-fold on every genuinely-new aggregate.
    const stateWithId: TraceAnalyticsData = state.traceId
      ? state
      : { ...state, traceId: String(context.aggregateId) };
    return {
      row: projectAnalyticsStateToRow({
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
   * Read the trace's last committed slim state back together with the
   * applied-event-id watermark (ADR-066) — the CH-fallthrough behind the Redis
   * cache miss. The typed read-back columns (migration 00056) let the trimmed
   * row round-trip the fold's working state — span count, the annotation id
   * set, name-resolution bookkeeping, the checkpoint — without replaying
   * `event_log`.
   *
   * Those columns are only trustworthy on a row this build wrote, so the row's
   * projection version is the discriminator: an older stamp means the row
   * predates the read-back columns and every one of them would decode as a
   * ClickHouse default indistinguishable from a real value — spanCount 0 resets
   * the MAX_PROCESSED_SPANS cap and re-adds committed cost/tokens,
   * `traceNameUserOverridden` false lets one late non-root span overwrite a
   * user-renamed trace, and `traceNameFromFallback` false freezes a
   * fallback-named trace against a real root that arrives later. So a
   * stale-version row is reported as a MISS (null state, empty watermark — the
   * same answer as "no row"), which the fold's `refoldOnStoreMiss` rebuilds from
   * `event_log` once; the rewrite carries the current version and every later
   * read hits. Transitional by construction: it stops firing as soon as the
   * aggregate is rewritten, and for the population as a whole once retention has
   * aged the pre-00056 rows out.
   *
   * The storage-anchor split (ADR-071 step 3, migration 00061) is the ONE stamp
   * change that does NOT take that route, and deliberately. Its predecessor is
   * admitted and decoded, because on a pre-split row `OccurredAt` is
   * `min(span start)` — at once a valid anchor (it is what the row is already
   * partitioned and TTL'd on) and the correct span timing baseline (it is what
   * the new column was split out to carry). Refusing it would force the whole
   * population to rebuild, and a rebuild re-derives the anchor — re-anchoring
   * every trace as the opening act of the change that exists to stop anchors
   * moving. See {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT} for why the
   * pair is unambiguous before the split and ambiguous after it.
   *
   * That "no refold" holds in the FORWARD direction, which is where the
   * population is. In the reverse it does not: during a rolling deploy a pod on
   * the previous build refuses the new stamp — its gate is a bare equality — and
   * refolds each row a new pod wrote, rewriting it at the old stamp. That is the
   * ordinary cost of any stamp bump, bounded by the deploy window rather than by
   * the size of the table, and it is precisely why the decode exists on the
   * forward path instead.
   *
   * `context.readWindow` — computed by the executor from the fold's declared
   * `options.readWindow` — prunes the read to a window of partitions around the
   * event being folded; it is passed through verbatim. On an ABSENT windowed
   * miss the EXECUTOR retries without the window, so a row outside it is still
   * found; this store neither widens the window nor implements a fallback
   * itself. A row that was FOUND and refused by the version gate is reported as
   * `miss: "undecodable"`, and the executor deliberately does not retry it — a
   * wider scope only finds the same row and refuses it again, so the retry was
   * an unpruned scan per event per stale aggregate that could never succeed.
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
