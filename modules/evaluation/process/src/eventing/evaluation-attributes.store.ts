import type { AnalyticsService } from "@langwatch/analytics-contract";
import type {
  FoldProjectionStore,
  ProjectionStoreContext,
  FoldStateRead,
} from "@langwatch/eventing";

import type { EvaluationAnalyticsAttributePolicy } from "../app/evaluation.members.ts";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
} from "./evaluation-analytics-fold.projection.ts";
import {
  type EvaluationAnalyticsRow,
  EvaluationAnalyticsRowProjection,
} from "./evaluation-analytics-row.projection.ts";

/**
 * FoldProjectionStore adapter for slim evaluation_analytics fold (ADR-066);
 * read-back via typed columns.
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
    entries: {
      state: EvaluationAnalyticsData;
      context: ProjectionStoreContext;
    }[],
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
    // ALWAYS writes; gate removed because evaluationId stamped from aggregateId always.
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

  /** Read committed state with watermark (ADR-066); decode via projection version. */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: EvaluationAnalyticsData | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.analytics.findEvaluationAnalytics({
      tenantId: String(context.tenantId),
      evaluationId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [], miss: "absent" };
    // Stale schema snapshot: the read-back columns didn't exist when this row
    // was written, so decoding would fabricate state. Answer as "no row" (drop
    // the watermark too, or it would suppress the events the re-fold needs) but
    // report `undecodable`, not `absent` — the row was found, so the executor
    // must not retry with an unwindowed re-read that only finds it again.
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
  ): Promise<FoldStateRead<EvaluationAnalyticsData>> {
    const { state } = await this.getWithApplied(aggregateId, context);
    return state === null ? { kind: "empty" } : { kind: "folded", state };
  }
}
