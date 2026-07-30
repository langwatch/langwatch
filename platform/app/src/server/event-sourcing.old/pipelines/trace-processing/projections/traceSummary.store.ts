import type { TraceSummaryRepository } from "~/server/app-layer/traces/repositories/trace-summary.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";

/**
 * Thin FoldProjectionStore adapter for trace summaries.
 * Delegates directly to TraceSummaryRepository (no mapper needed — projection uses camelCase types).
 *
 * Read-back (ADR-099): `get`/`getWithApplied` decode the last committed
 * `trace_summaries` row so the delivery path does not refold from `event_log`,
 * and decoding is gated on the stamp that row carries — see `getWithApplied`.
 */
export class TraceSummaryStore
  implements FoldProjectionStore<TraceSummaryData>
{
  /**
   * The stamp this store's rows carry — the same constant the repository writes
   * into `trace_summaries.Version` on every upsert.
   *
   * Published so the `CachedFoldStore` in front of this store folds it into its
   * key. Without it the cache key has no version segment, so a build that
   * changed the state shape would read the previous shape straight back out of
   * Redis and fold onto it. Keyed by version, a shape change simply misses and
   * the read falls through to the repository.
   *
   * The durable tier compares this same constant against the stamp the row
   * itself carries (`getWithApplied`), so both tiers agree on what "this shape"
   * means and neither can be version-aware alone.
   */
  readonly projectionVersion = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;

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
    await this.repo.upsert(
      stateWithId,
      String(context.tenantId),
      retentionDays,
    );
  }

  /**
   * Persists many trace summaries in one round-trip. Empty traces are dropped
   * and the repository's batch upsert is used when available, falling back to
   * per-entry upserts otherwise.
   */
  async storeBatch(
    entries: Array<{
      state: TraceSummaryData;
      context: ProjectionStoreContext;
    }>,
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

  /**
   * The trace's last committed summary, refusing any row this build cannot
   * read (ADR-099).
   *
   * `trace_summaries` is the fold's own state: `get()` returns it and the fold
   * continues from there, so a row decoded under the wrong shape is not a stale
   * read, it is a fold that carries on from fabricated state and commits the
   * result. The row's `Version` column is the only thing that says which build
   * wrote it, so it is the discriminator.
   *
   * ONLY the current stamp is decodable — the bare equality `evaluationAnalytics`
   * uses, not `traceAnalytics`'s two-member set, and the difference is a claim
   * about THIS table's history rather than a style choice. Admitting an older
   * stamp asserts that `fromClickHouseRecord` derives every field correctly from
   * that shape, and no trace-summary predecessor discharges that claim: the one
   * stamp before this (`2026-04-23`) predates the span-flag (migration 00020)
   * and prompt (00021) columns, whose ClickHouse zero-defaults cannot be told
   * apart from real values — `ContainsAi = 0` on a trace that did call a model,
   * an empty `SelectedPromptId` on a trace that did select a prompt. Decoding
   * one fabricates exactly what this gate exists to refuse, and the fold then
   * re-commits the fabrication stamped at the CURRENT version, laundering it
   * past the gate for good. `traceAnalytics` admits its predecessor because
   * there the delta is one column whose old value is provably the same value;
   * here it is several columns whose old value is provably unknowable.
   *
   * Refusing costs a rebuild, and that cost is bounded and shrinking: the
   * platform default retention is far shorter than the age of that stamp (it
   * stopped being written in May 2026), so only long-retention tenants still
   * hold such rows — each rebuilt once by the fold's `refoldOnStoreMiss` and
   * rewritten at the current stamp, after which every read hits.
   *
   * A refused row is a MISS: null state AND an empty watermark, the same answer
   * as "no row". Dropping the watermark matters — a watermark without the state
   * it belongs to would make the executor skip the very events the re-fold needs
   * to replay. It is reported as `undecodable` rather than `absent` because the
   * row was FOUND and refused: the executor answers an `absent` windowed miss
   * with an unwindowed re-read, which here would only find the same row and
   * refuse it again, and would spend the read-window signal on a schema
   * condition that has nothing to do with the window.
   *
   * The watermark is always empty on this store: `trace_summaries` has no
   * applied-event-id column, so a cold cache still degrades to a blind re-apply
   * exactly as it did before this method existed. `getWithApplied` is here for
   * the `miss` channel, which `get()` alone cannot carry.
   *
   * `context.readWindow` — computed by the executor from the fold's declared
   * `options.readWindow` — bounds the read so trace_summaries (partitioned by
   * toYearWeek(OccurredAt)) prunes partitions instead of cold-scanning them all
   * (incl. S3 tier). Passed through verbatim, and the repository applies it
   * verbatim (no internal fallback on this path): the EXECUTOR retries a
   * windowed miss without the window, which lands on the repository's
   * resolve-OccurredAt path — so correctness never depends on the width, and no
   * layer runs a second recovery ladder.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: TraceSummaryData | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.repo.findByTraceIdWithVersion(
      String(context.tenantId),
      aggregateId,
      context.readWindow !== undefined
        ? { window: context.readWindow }
        : undefined,
    );
    if (!found) return { state: null, appliedEventIds: [], miss: "absent" };
    if (found.version !== TRACE_SUMMARY_PROJECTION_VERSION_LATEST) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return { state: found.state, appliedEventIds: [] };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<TraceSummaryData | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
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
