/**
 * `eval_results` rows on the way in and out: the insert's values, the recall's filters, the
 * recalled row's shape, and the inserts a batch is split into.
 */

import { Temporal, toDate } from "@langwatch/time";

import type {
  EvalResultRecord,
  EvalResultsRecallQuery,
  RecalledEvalResult,
} from "../eval-results.repository.ts";
import { parseProbabilities } from "./clickhouse.instant-eval-judgments.mapper.ts";

/**
 * Partitions one insert may touch: ClickHouse's `max_partitions_per_insert_block`. The table is
 * partitioned by the trace's week, so a run over old traces spans many.
 */
export const EVAL_RESULTS_MAX_WEEKS_PER_INSERT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Sunday-started week an instant falls in, counted from the epoch: the grain of
 * `toYearWeek(OccurredAt)`. 1970-01-01 was a Thursday, so the first Sunday is four days on.
 */
export function evalResultsWeekOf(epochMilliseconds: number): number {
  return Math.floor((Math.floor(epochMilliseconds / DAY_MS) + 4) / 7);
}

/** The records in inserts of at most {@link EVAL_RESULTS_MAX_WEEKS_PER_INSERT} trace weeks each. */
export function evalResultsInsertBatches(
  records: readonly EvalResultRecord[],
): readonly (readonly EvalResultRecord[])[] {
  const byWeek = new Map<number, EvalResultRecord[]>();
  for (const record of records) {
    const week = evalResultsWeekOf(record.OccurredAt);
    const inWeek = byWeek.get(week);
    if (inWeek) inWeek.push(record);
    else byWeek.set(week, [record]);
  }
  const weeks = [...byWeek.keys()].toSorted((left, right) => left - right);
  const batches: EvalResultRecord[][] = [];
  for (let start = 0; start < weeks.length; start += EVAL_RESULTS_MAX_WEEKS_PER_INSERT) {
    const batch = weeks
      .slice(start, start + EVAL_RESULTS_MAX_WEEKS_PER_INSERT)
      .flatMap((week) => byWeek.get(week) ?? []);
    batches.push(batch);
  }
  return batches;
}

/** The driver formats dates, so a record's epoch millis become one here. */
function atEpoch(at: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(at));
}

/** One record as the insert sends it. */
export function toEvalResultValues(record: EvalResultRecord): Record<string, unknown> {
  return {
    ...record,
    OccurredAt: atEpoch(record.OccurredAt),
    JudgedAt: atEpoch(record.JudgedAt),
    UpdatedAt: atEpoch(record.UpdatedAt),
  };
}

/**
 * A recalled row as the recall query answers it. The ordering columns carry a `Latest` prefix so
 * no alias shadows the column it is read from; times are epoch milliseconds, maybe quoted.
 */
export interface RecalledEvalResultRow {
  TraceId: string;
  SpanId: string;
  QuestionHash: string;
  InputHash: string;
  LatestSourceId: string;
  Score: number | null;
  Label: string;
  Probability: number | null;
  Probabilities: string;
  LatestJudgedAt: number | string;
  LatestUpdatedAt: number | string;
}

export function toRecalledEvalResult(row: RecalledEvalResultRow): RecalledEvalResult {
  return {
    traceId: row.TraceId,
    spanId: row.SpanId,
    questionHash: row.QuestionHash,
    inputHash: row.InputHash,
    sourceId: row.LatestSourceId,
    score: row.Score,
    label: row.Label === "" ? null : row.Label,
    probability: row.Probability,
    probabilities: parseProbabilities(row.Probabilities),
    judgedAt: Number(row.LatestJudgedAt),
    updatedAt: Number(row.LatestUpdatedAt),
  };
}

/**
 * The recall's bound parameters. The key columns are matched each as a set, which may also match
 * a combination no cell asked for; the caller keeps only the exact keys it asked about.
 */
export function evalResultsRecallParameters(
  query: EvalResultsRecallQuery,
): Record<string, unknown> {
  const distinct = (pick: (key: EvalResultsRecallQuery["keys"][number]) => string) => [
    ...new Set(query.keys.map(pick)),
  ];

  return {
    tenantId: query.tenantId,
    occurredFrom: atEpoch(query.occurredFrom),
    occurredUntil: atEpoch(query.occurredUntil),
    traceIds: distinct((key) => key.traceId),
    spanIds: distinct((key) => key.spanId),
    questionHashes: distinct((key) => key.questionHash),
    inputHashes: distinct((key) => key.inputHash),
    judgeModel: query.judgeModel,
    keyVersion: query.keyVersion,
    status: "judged",
  };
}
