import type { TraceAnalyticsRepository } from "~/server/app-layer/traces/repositories/trace-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsData,
  traceAnalyticsStateFromRow,
} from "./traceAnalytics.foldProjection";

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
 * (typed read-back columns, migration 00056) so the delivery path does not
 * refold from `event_log`; the applied-event-id watermark rides next to the row
 * so a cold-cache retry still dedups a redelivered batch. Decoding is gated on
 * the row's projection version — see `getWithApplied`.
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
    const found = await this.repo.findByTraceIdWithApplied({
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

/**
 * Same persistable-signal predicate the trace-summary store uses. Spans-only
 * gating is too strict for log-only emitters (Claude Code Path B, Codex Path B);
 * the trace-summary fold counts log records via
 * langwatch.reserved.log_record_count and we mirror its acceptance.
 *
 * `occurredAt > 0` is the second door onto the same signal: only a folded span
 * ever sets it (never a phantom init state), so it admits a state whose real
 * timing survived even if the span counter did not.
 *
 * A state carrying ONLY dimension signal (topic / annotation / name, no span or
 * log record) still writes nothing — and that is now SAFE rather than lossy: no
 * row means `get()` misses, and the fold's `refoldOnStoreMiss` rebuilds the
 * dimension from `event_log`. Before the version gate restored that net, such a
 * state lived in Redis alone and its signal was lost for good on eviction.
 *
 * `storageAnchorMs` is deliberately NOT a third door, even though ADR-071 step 3
 * gives every contribution a real anchor and so removes the only technical
 * reason such a row could not be written. What decides it is not the anchor: a
 * row on this table is a TRACE for every analytics read — it is counted,
 * grouped and averaged over — so admitting a trace whose sole signal is an
 * annotation or a classification would change what the product means by "a
 * trace", not just what the fold persists. That is a product call, and it is not
 * this change's to make.
 */
function hasPersistableSignal(state: TraceAnalyticsData): boolean {
  if (state.spanCount > 0) return true;
  if (state.occurredAt > 0) return true;
  const raw = state.attributes?.["langwatch.reserved.log_record_count"];
  return typeof raw === "string" && Number(raw) > 0;
}
