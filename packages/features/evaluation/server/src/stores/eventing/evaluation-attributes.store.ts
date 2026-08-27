import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
} from "../../projections/evaluation-analytics-fold.projection";
import {
  type EvaluationAnalyticsRow,
  EvaluationAnalyticsRowProjection,
} from "../../projections/evaluation-analytics-row.projection";
import type { EvaluationAnalyticsAttributePolicy } from "../../ports/evaluation.port";

/**
 * `FoldProjectionStore` adapter for the slim `evaluation_analytics` fold
 * (ADR-034 Phase 6 — eval mirror of `TraceAnalyticsStore`, read-back per
 * ADR-066).
 *
 * Skips empty rows (no identity stamped yet), falls back to the aggregateId
 * when the state has no evaluationId, stamps the per-tenant retention onto the
 * record, and projects the in-memory `EvaluationAnalyticsData` accumulator into
 * the slim row at write time.
 *
 * The slim row is derived deterministically from a fold state whose handlers
 * mirror the `EvaluationRunFoldProjection` for the shared fields, so the
 * persisted hoisted-dim columns (Status / Score / Passed / Label /
 * EvaluatorType / TraceId / IsGuardrail) match `evaluation_runs` to the cent for
 * the SAME evaluation. The slim Attributes map is trimmed by
 * `trimAttributesForAnalytics` inside the projection function so payload-shaped
 * keys never reach the wire.
 *
 * Read-back (ADR-066): `tryGet`/`getWithApplied` decode the last committed row
 * (typed read-back columns, migration 00056) so the delivery path does not
 * refold from `event_log`; the applied-event-id watermark rides next to the row
 * so a cold-cache retry still dedups a redelivered batch. Decoding is gated on
 * the row's projection version — see `getWithApplied`.
 */
export class EvaluationAnalyticsStore implements FoldProjectionStore<EvaluationAnalyticsData> {
  static create(input: {
    analytics: AnalyticsService;
    attributePolicy: EvaluationAnalyticsAttributePolicy;
    defaultRetentionDays: number;
  }): EvaluationAnalyticsStore {
    return new EvaluationAnalyticsStore(
      input.analytics,
      input.attributePolicy,
      input.defaultRetentionDays,
    );
  }

  private readonly rowProjection = EvaluationAnalyticsRowProjection.create();

  private constructor(
    private readonly analytics: AnalyticsService,
    private readonly attributePolicy: EvaluationAnalyticsAttributePolicy,
    private readonly defaultRetentionDays: number,
  ) {}

  async store(state: EvaluationAnalyticsData, context: ProjectionStoreContext): Promise<void> {
    const entry = this.toRow(state, context);
    if (!entry) return;
    await this.analytics.upsertEvaluationAnalytics({
      row: entry.row,
      retentionDays: entry.retentionDays,
      appliedEventIds: entry.appliedEventIds,
    });
  }

  async storeBatch(
    entries: Array<{
      state: EvaluationAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .map(({ state, context }) => this.toRow(state, context))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (batchRows.length === 0) return;

    await this.analytics.upsertEvaluationAnalyticsBatch(
      batchRows.map(({ row, retentionDays, appliedEventIds }) => ({
        row,
        retentionDays,
        appliedEventIds,
      })),
    );
  }

  private toRow(
    state: EvaluationAnalyticsData,
    context: ProjectionStoreContext,
  ): {
    row: EvaluationAnalyticsRow;
    retentionDays: number;
    appliedEventIds: string[];
  } | null {
    // ALWAYS writes. The old gate here refused a state with neither
    // evaluationId nor evaluatorId — but the very next line stamps
    // evaluationId from the aggregate id (which the executor asserts
    // non-empty), so an unaddressable row was never actually reachable; the
    // gate's real effect was to make row ABSENCE ambiguous, which forced the
    // executor to treat every store miss as potentially-unpersisted state and
    // pay an unwindowed fallback scan (79,861 in 30 days, none of which found
    // anything) plus an `event_log` re-fold. A committed state now always has
    // a row, so absence is authoritative (`trustAbsentMiss`).
    const stateWithId: EvaluationAnalyticsData = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    return {
      row: this.rowProjection.project({
        state: stateWithId,
        tenantId: String(context.tenantId),
        version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
        attributePolicy: this.attributePolicy,
      }),
      retentionDays: context.retentionPolicy?.traces ?? this.defaultRetentionDays,
      appliedEventIds: context.appliedEventIds ? [...context.appliedEventIds] : [],
    };
  }

  /**
   * Read the evaluation's last committed slim state back together with the
   * applied-event-id watermark (ADR-066) — the CH-fallthrough behind the Redis
   * cache miss. The typed read-back columns (migration 00056) let the trimmed
   * row round-trip the lifecycle operands DurationMs is derived from, without
   * replaying `event_log`.
   *
   * Those columns are only trustworthy on a row this build wrote, so the row's
   * projection version is the discriminator: an older stamp means the row
   * predates the read-back columns, and its null StartedAt/CompletedAt are
   * indistinguishable from a genuinely unstarted evaluation — a `completed`
   * event folded onto them would compute a zero duration over a real one. So a
   * stale-version row is reported as a MISS (null state, empty watermark — the
   * same answer as "no row"), which the fold's `refoldOnStoreMiss` rebuilds from
   * `event_log` once; the rewrite carries the current version and every later
   * read hits. Transitional by construction: it stops firing as soon as the
   * aggregate is rewritten, and for the population as a whole once retention has
   * aged the pre-00056 rows out.
   *
   * `context.readWindow` is passed through verbatim; on an ABSENT windowed miss
   * the EXECUTOR retries without the window, so a row outside it is still
   * found. A row FOUND and refused by the version gate is reported as
   * `miss: "undecodable"` and deliberately not retried — a wider scope finds
   * the same row and refuses it again.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: EvaluationAnalyticsData | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.analytics.tryGetEvaluationAnalytics({
      tenantId: String(context.tenantId),
      evaluationId: aggregateId,
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
    if (found.row.version !== EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: this.rowProjection.fromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<EvaluationAnalyticsData | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }
}
