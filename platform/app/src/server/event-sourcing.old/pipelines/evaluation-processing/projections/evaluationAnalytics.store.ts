import type { EvaluationAnalyticsRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics.repository";
import { defineFoldStore } from "../../../projections/foldStore/defineFoldStore";
import { foldCodec } from "../../../projections/foldStore/foldCodec";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
  type EvaluationAnalyticsRow,
  evaluationAnalyticsStateFromRow,
  projectEvaluationAnalyticsStateToRow,
} from "./evaluationAnalytics.foldProjection";

/**
 * The fold store for the slim `evaluation_analytics` fold (ADR-099 —
 * eval mirror of the trace analytics store, read-back per the same ADR).
 *
 * The whole store is its round-trip: `project` derives the slim row from the
 * accumulator, `decode` recovers the accumulator from the row. Retention
 * stamping, the read-back gate, the rebuild that gate needs, telling a refused
 * row from an absent one, the batch/single write duality, the applied-event
 * watermark and the cache tier are all supplied by `defineFoldStore` — the
 * same way, for every fold.
 */
export const evaluationAnalyticsFoldStore = defineFoldStore<
  EvaluationAnalyticsData,
  EvaluationAnalyticsRow,
  EvaluationAnalyticsRepository
>({
  name: "evaluation_analytics",
  retention: "traces",

  /**
   * An evaluation with no identity of any kind is a half-formed scheduled-only
   * state; committing it would churn the slim table for evaluations that never
   * reach a terminal status, and would write a row whose primary key is empty.
   */
  signal: (state) => Boolean(state.evaluationId || state.evaluatorId),

  read: (repository, { tenantId, aggregateId, window }) =>
    repository.findByEvaluationIdWithApplied({
      tenantId,
      evaluationId: aggregateId,
      window,
    }),

  codec: foldCodec<EvaluationAnalyticsData, EvaluationAnalyticsRow>({
    /**
     * One shape so far. Migration 00056 added the lifecycle operands
     * `DurationMs` is derived from, and the stamp moved with it — so a row
     * carrying any older stamp is at no generation this fold knows, is refused,
     * and is rebuilt once.
     */
    generations: [{ stamp: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST }],
    readBackSince: 1,

    /**
     * What `decode` reads back. A row written before these columns existed
     * decodes them as ClickHouse defaults indistinguishable from real values —
     * a null StartedAt on an evaluation that did start makes the next
     * `completed` event compute a zero duration over a real one — which is why
     * changing this list without declaring a generation is a build failure.
     */
    reads: [
      "Status",
      "Score",
      "Passed",
      "Label",
      "Model",
      "EvaluatorType",
      "EvaluatorName",
      "IsGuardrail",
      "TraceId",
      "Attributes",
      "StartedAt",
      "CompletedAt",
      "OccurredAt",
      "CreatedAt",
      "UpdatedAt",
    ],

    project: (state, { tenantId, aggregateId, version }) =>
      projectEvaluationAnalyticsStateToRow({
        // The key is the evaluation id; a state that has not yet been handed one
        // by an event takes it from the aggregate it is folding.
        state: state.evaluationId
          ? state
          : { ...state, evaluationId: aggregateId },
        tenantId,
        version,
      }),

    decode: evaluationAnalyticsStateFromRow,
  }),
});

/**
 * The durable tier, for the composition site that still assembles its cache by
 * hand. `evaluationAnalyticsFoldStore.cached({ repository, cache })` is the
 * shape to use once that site moves.
 */
export const EvaluationAnalyticsStore = evaluationAnalyticsFoldStore.Store;
export type EvaluationAnalyticsStore = InstanceType<
  typeof EvaluationAnalyticsStore
>;
