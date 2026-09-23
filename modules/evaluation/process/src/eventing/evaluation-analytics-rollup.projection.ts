import {
  type EvaluationCompletedEvent,
  type EvaluationReportedEvent,
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
} from "@langwatch/evaluation-contract";
import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";

/** A moment as a ClickHouse statement carries it. The client serialises this into
 *  `DateTime64(3)`; an instant serialises to `{}`, so the conversion is here. */
type ClickHouseMoment = ReturnType<typeof toDate>;

/** The moment `epochMilliseconds` names, as ClickHouse wants it. */
const clickHouseMomentOf = (epochMilliseconds: number): ClickHouseMoment =>
  toDate(Temporal.Instant.fromEpochMilliseconds(epochMilliseconds));

/**
 * One row per terminal evaluation event (ADR-034 Phase 6). Field names match
 * ClickHouse columns for direct JSONEachRow serialization. Handles both completed
 * and reported event types; blank EvaluatorType for completed-only events.
 * @see ADR-034
 */
export interface EvaluationAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the evaluation's completion (toStartOfMinute). */
  bucketStart: ClickHouseMoment;
  /**
   * Evaluator slug (e.g. `langevals/llm_answer_match`). `''` when not on the
   * event payload (the two-event completed-only path; see class doc above).
   */
  evaluatorType: string;
  /** Terminal evaluation status: `processed` | `error` | `skipped`. */
  status: string;
  /** Always 1 (one row per terminal event). */
  evalCount: number;
  /** 1 when `status === 'processed'` and `passed === true`, 0 otherwise. */
  passCount: number;
  /** 1 when `status === 'processed'` and `passed === false`, 0 otherwise. */
  failCount: number;
  /** 1 when `status === 'error'`, 0 otherwise. */
  errorCount: number;
  /** 1 when `status === 'skipped'`, 0 otherwise. */
  skippedCount: number;
  /** Score sum when processed; 0 otherwise. Pairs with scoreCount for average. */
  scoreSum: number;
  /** Count of finite scores for processed evaluations; divisor for average. */
  scoreCount: number;
  /**
   * Evaluation wall-clock duration in ms. Always 0 here — the event payload
   * carries no timestamps; the slim fold computes it from accumulated state.
   * Kept on the row so the column shape matches the DDL.
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
function toStartOfMinute(unixMs: number): ClickHouseMoment {
  return clickHouseMomentOf(Math.floor(unixMs / 60_000) * 60_000);
}

/**
 * A verdict (passed/score) is real only when the evaluation completed —
 * producers can attach `passed: false` alongside `status: "error"` (#6833).
 * The status guard stops such an event double-counting FailCount and ErrorCount.
 */
function scoreOf({ status, score }: { status: string; score: number | null | undefined }): {
  scoreSum: number;
  scoreCount: number;
} {
  if (status !== "processed" || typeof score !== "number" || !Number.isFinite(score)) {
    return { scoreSum: 0, scoreCount: 0 };
  }
  return { scoreSum: score, scoreCount: 1 };
}

function passFailOf({ status, passed }: { status: string; passed: boolean | null | undefined }): {
  passCount: number;
  failCount: number;
} {
  if (status !== "processed") return { passCount: 0, failCount: 0 };
  if (passed === true) return { passCount: 1, failCount: 0 };
  if (passed === false) return { passCount: 0, failCount: 1 };
  return { passCount: 0, failCount: 0 };
}

/**
 * Map projection for terminal eval events to rollup rows (ADR-034 Phase 6). At-least-once
 * by design; `dedupeByIdempotencyKey` guards against duplicate over-counting.
 * @see ADR-034
 */
export class EvaluationAnalyticsRollupMapProjection
  extends AbstractMapProjection<EvaluationAnalyticsRollupRow, typeof evaluationRollupEvents>
  implements MapEventHandlers<typeof evaluationRollupEvents, EvaluationAnalyticsRollupRow>
{
  static create(deps: {
    store: AppendStore<EvaluationAnalyticsRollupRow>;
  }): EvaluationAnalyticsRollupMapProjection {
    return new EvaluationAnalyticsRollupMapProjection(deps);
  }

  readonly name = "evaluationAnalyticsRollup";
  readonly store: AppendStore<EvaluationAnalyticsRollupRow>;
  protected readonly events = evaluationRollupEvents;

  override options = {
    // Per-event parallelism — rollup rows are independent of each other
    // and of sibling evaluations on the same trace (the rollup is dim-keyed,
    // not eval-keyed).
    groupKeyFn: (event: { id: string }): string => `evalRollup:${event.id}`,
    // Eval terminal events are re-reported by design (deterministic ids,
    // SDK retries); without this, every duplicate append double-counts the
    // bucket. See the class doc.
    dedupeByIdempotencyKey: true,
  };

  constructor(deps: { store: AppendStore<EvaluationAnalyticsRollupRow> }) {
    super();
    this.store = deps.store;
  }

  mapEvaluationCompleted(event: EvaluationCompletedEvent): EvaluationAnalyticsRollupRow {
    const { score, passed, status } = event.data;
    const { scoreSum, scoreCount } = scoreOf({ status, score });
    const { passCount, failCount } = passFailOf({ status, passed });
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

  mapEvaluationReported(event: EvaluationReportedEvent): EvaluationAnalyticsRollupRow {
    const { score, passed, status, evaluatorType } = event.data;
    const { scoreSum, scoreCount } = scoreOf({ status, score });
    const { passCount, failCount } = passFailOf({ status, passed });
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
