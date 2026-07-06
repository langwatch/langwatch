import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type EvaluationCompletedEvent,
  type EvaluationReportedEvent,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
} from "../schemas/events";

/**
 * One row emitted to `evaluation_analytics_rollup` per terminal evaluation
 * event (ADR-034 Phase 6 — eval mirror of `traceAnalyticsRollup.mapProjection`).
 *
 * Field names match the ClickHouse columns exactly (PascalCase) on the
 * camelCase record so the repository hands the record to `JSONEachRow`
 * without a second mapping layer. `BucketStart` is a JS `Date` floored to
 * the minute — the CH client serializes it as a `DateTime64(3)` literal.
 *
 * The map projection subscribes to BOTH terminal eval event types because
 * either may be the per-evaluation-row source:
 *
 *   - `EvaluationCompletedEvent` (`lw.evaluation.completed`) — the regular
 *     two-event path (scheduled → started → completed). Identity fields
 *     (evaluatorId / evaluatorType / evaluatorName / traceId / isGuardrail)
 *     are NOT on the completed event itself; they were set on the prior
 *     scheduled/started events and we read them off the fold state. Since
 *     the map projection has no fold-state access, the rollup row that
 *     comes from a `completed` event falls back to `EvaluatorType = ""` if
 *     the identity was not on a `reported`-style atomic emission. Operators
 *     reading the rollup get correct counts/sums (the additive metrics);
 *     they just lose the `EvaluatorType` group-by axis for the two-event
 *     evaluations — the slim table still has the correct value because the
 *     fold projection has identity context via its prior-event state.
 *
 *   - `EvaluationReportedEvent` (`lw.evaluation.reported`) — atomic single-
 *     event variant used by the custom SDK report path. Identity + result
 *     ride the same event so the rollup row carries the real EvaluatorType
 *     immediately.
 *
 * The rationale for accepting the EvaluatorType blank-out on completed-only
 * events: the rollup's purpose is additive sums per bucket / evaluator /
 * status, and `EvaluatorType` is a LowCardinality(String) so `''` is a
 * cheap, well-defined fallback. Refusing to emit a row for completed-only
 * events would silently under-count, which is worse. Phase 7 (or whichever
 * iteration adds per-aggregate event-stream context to map projections)
 * can promote this rollup row in retrospect.
 */
export interface EvaluationAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the evaluation's completion (toStartOfMinute). */
  bucketStart: Date;
  /**
   * Evaluator slug (e.g. `langevals/llm_answer_match`). `''` when not on the
   * event payload (the two-event completed-only path; see class doc above).
   */
  evaluatorType: string;
  /** Terminal evaluation status: `processed` | `error` | `skipped`. */
  status: string;
  /** Always 1 (one row per terminal event). */
  evalCount: number;
  /** 1 when `passed === true`, 0 otherwise (including null and false). */
  passCount: number;
  /** 1 when `passed === false`, 0 otherwise (including null and true). */
  failCount: number;
  /** 1 when `status === 'error'`, 0 otherwise. */
  errorCount: number;
  /** 1 when `status === 'skipped'`, 0 otherwise. */
  skippedCount: number;
  /** The event's `score` value, 0 when null. Pairs with `scoreCount` for true avg. */
  scoreSum: number;
  /** 1 when `score` is a finite number, 0 otherwise. Divisor for true avg. */
  scoreCount: number;
  /**
   * Evaluation wall-clock duration in ms. Always 0 from this projection —
   * the event payload doesn't carry started/completed timestamps; the slim
   * fold computes duration from its accumulated state. Kept on the row so
   * the column shape matches the DDL.
   */
  durationSum: number;
  /** Always 0 from this projection — eval cost lives in the Postgres `cost` table by FK. */
  costSum: number;
  /** Always 0 from this projection — same reason as costSum. */
  nonBilledCostSum: number;
}

const evaluationRollupEvents = [
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
] as const;

/** Floor a unix-ms timestamp to the minute boundary (toStartOfMinute equivalent). */
function toStartOfMinute(unixMs: number): Date {
  return new Date(Math.floor(unixMs / 60_000) * 60_000);
}

function scoreOf(value: number | null | undefined): {
  scoreSum: number;
  scoreCount: number;
} {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { scoreSum: 0, scoreCount: 0 };
  }
  return { scoreSum: value, scoreCount: 1 };
}

function passFailOf(value: boolean | null | undefined): {
  passCount: number;
  failCount: number;
} {
  if (value === true) return { passCount: 1, failCount: 0 };
  if (value === false) return { passCount: 0, failCount: 1 };
  return { passCount: 0, failCount: 0 };
}

/**
 * Map projection that transforms terminal evaluation events into per-event
 * rollup rows for `evaluation_analytics_rollup` (ADR-034 Phase 6).
 *
 * Idempotency / re-delivery: each insert is a separate row in the
 * AggregatingMergeTree; a rare retry over-counts the bucket by one
 * evaluation's contribution. ADR-034 accepts that explicitly. Replay
 * rebuilds the rollup truncate-first rather than incrementing it.
 */
export class EvaluationAnalyticsRollupMapProjection
  extends AbstractMapProjection<
    EvaluationAnalyticsRollupRow,
    typeof evaluationRollupEvents
  >
  implements
    MapEventHandlers<
      typeof evaluationRollupEvents,
      EvaluationAnalyticsRollupRow
    >
{
  readonly name = "evaluationAnalyticsRollup";
  readonly store: AppendStore<EvaluationAnalyticsRollupRow>;
  protected readonly events = evaluationRollupEvents;

  override options = {
    // Per-event parallelism — rollup rows are independent of each other
    // and of sibling evaluations on the same trace (the rollup is dim-keyed,
    // not eval-keyed).
    groupKeyFn: (event: { id: string }) => `evalRollup:${event.id}`,
  };

  constructor(deps: { store: AppendStore<EvaluationAnalyticsRollupRow> }) {
    super();
    this.store = deps.store;
  }

  mapEvaluationCompleted(
    event: EvaluationCompletedEvent,
  ): EvaluationAnalyticsRollupRow {
    const { score, passed, status } = event.data;
    const { scoreSum, scoreCount } = scoreOf(score);
    const { passCount, failCount } = passFailOf(passed);
    return {
      tenantId: event.tenantId,
      bucketStart: toStartOfMinute(event.occurredAt),
      // `EvaluationCompletedEvent` carries no identity fields — they were
      // stamped on the earlier scheduled/started events and live on the fold
      // state. The map projection has no fold-state access; we emit an empty
      // string here. See class-level doc for rationale.
      evaluatorType: "",
      status,
      evalCount: 1,
      passCount,
      failCount,
      errorCount: status === "error" ? 1 : 0,
      skippedCount: status === "skipped" ? 1 : 0,
      scoreSum,
      scoreCount,
      durationSum: 0,
      costSum: 0,
      nonBilledCostSum: 0,
    };
  }

  mapEvaluationReported(
    event: EvaluationReportedEvent,
  ): EvaluationAnalyticsRollupRow {
    const { score, passed, status, evaluatorType } = event.data;
    const { scoreSum, scoreCount } = scoreOf(score);
    const { passCount, failCount } = passFailOf(passed);
    return {
      tenantId: event.tenantId,
      bucketStart: toStartOfMinute(event.occurredAt),
      evaluatorType,
      status,
      evalCount: 1,
      passCount,
      failCount,
      errorCount: status === "error" ? 1 : 0,
      skippedCount: status === "skipped" ? 1 : 0,
      scoreSum,
      scoreCount,
      durationSum: 0,
      costSum: 0,
      nonBilledCostSum: 0,
    };
  }
}
