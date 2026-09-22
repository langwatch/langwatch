/**
 * A judged page, turned into the rows that are kept and the numbers that are
 * reported: one row per judged text per question, and the only place that
 * knows which part of a verdict each eval function's column carries.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { InstantEvalJudgmentStatus } from "@langwatch/instant-eval-contract";
import type { Instant } from "@langwatch/time";

import type { InstantEvalJudgmentRecord } from "../repositories/instant-eval-judgments.repository.ts";
import {
  INSTANT_EVAL_SPAN_COLUMN,
  INSTANT_EVAL_TRACE_COLUMN,
} from "./instant-eval-composition.rules.ts";
import {
  findInstantEvalRowKeys,
  instantEvalKeyIndex,
  instantEvalRowText,
  type InstantEvalRowKey,
} from "./instant-eval-row-keys.rules.ts";
import type { InstantEvalRunQuestion } from "./instant-eval-run-questions.rules.ts";
import { countsForQuestion, isBooleanMatch, verdictOf } from "./instant-eval-verdicts.rules.ts";

/** The window a run's judgements were written in, read off the run's own clock. */
export function instantEvalWrittenWindow(
  row: Readonly<{ createdAt: Instant; startedAt: Instant | null; finishedAt: Instant | null }>,
  now: Instant,
): { readonly writtenFrom: Instant; readonly writtenUntil: Instant } {
  return {
    writtenFrom: row.startedAt ?? row.createdAt,
    writtenUntil: row.finishedAt ?? now,
  };
}

/**
 * How far past its last write a run's judgements may still land, and how far
 * before its acceptance one could have been written: clock skew between the
 * service that accepted the run and the worker that judged it.
 */
const INSTANT_EVAL_WRITE_SKEW_HOURS = 1;

/** The same window for a reader of writes another process made, widened by that skew. */
export function instantEvalSkewedWrittenWindow(
  row: Readonly<{ createdAt: Instant; finishedAt: Instant | null }>,
  now: Instant,
): { readonly writtenFrom: Instant; readonly writtenUntil: Instant } {
  return {
    writtenFrom: row.createdAt.subtract({ hours: INSTANT_EVAL_WRITE_SKEW_HOURS }),
    writtenUntil: (row.finishedAt ?? now).add({ hours: INSTANT_EVAL_WRITE_SKEW_HOURS }),
  };
}

/** What one page added to a run's running totals. */
export interface InstantEvalPageCounters {
  /** Rows judged, which is rows of the page that came back. */
  readonly rows: number;
  /**
   * Judgements that matched, across the run's BOOLEAN questions only: a score
   * and a category have no "yes". Null when the run asked none.
   */
  readonly matched: number | null;
  /** Per question: matches for a boolean one, judged rows for the others. */
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  /** Judgements the judge attempted and lost. */
  readonly failed: number;
  /** Judgements the judge declined to make. */
  readonly skipped: number;
}

export interface InstantEvalPageMapping {
  readonly records: readonly InstantEvalJudgmentRecord[];
  readonly counters: InstantEvalPageCounters;
}

/**
 * The share of a page's judgements past which the page is thrown back to the
 * queue rather than recorded: above it the page is mostly nothing, and
 * recording it would bake a bad minute of the provider's day into the run.
 */
export const INSTANT_EVAL_PAGE_FAILURE_CEILING = 0.5;

/** One judged cell, as the page mapping produced it. */
interface InstantEvalMappedJudgment {
  readonly record: InstantEvalJudgmentRecord;
  /** Whether a boolean question came back true. Feeds the run's own total. */
  readonly isBooleanMatch: boolean;
  /** Whether it counts toward its own question's number. */
  readonly countsForQuestion: boolean;
}

/**
 * Whether a cell means the judge answered. Null is the skip, and its reason is
 * reported for the page rather than per cell: one request answers every
 * question about one text.
 */
function isAnswered(cell: unknown): boolean {
  return cell !== null && cell !== undefined && cell !== "";
}

/**
 * The reason a page's unjudged cells carry: the commonest the hydration stage
 * reported. `classifier_failed` breaks a tie, so a page that lost rows is
 * never reported as having declined them.
 */
export function instantEvalSkipReason(skipped: Readonly<Record<string, number>>): string {
  const entries = Object.entries(skipped);
  if (entries.length === 0) return "";

  let best = entries[0] as [string, number];
  for (const entry of entries.slice(1)) {
    const isMoreCommon = entry[1] > best[1];
    const breaksTieAsFailure = entry[1] === best[1] && entry[0] === "classifier_failed";
    if (isMoreCommon || breaksTieAsFailure) best = entry;
  }

  return best[0];
}

/**
 * One page's rows as judgements and counters. `skipReason` is the page's
 * dominant skip and is written onto the rows that have no verdict, which is
 * the grain the classifier's own contract offers.
 */
export function mapInstantEvalPage({
  tenantId,
  runId,
  questions,
  rows,
  keys,
  skipReason,
  unjudgedRows,
  now,
}: {
  readonly tenantId: string;
  readonly runId: string;
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly rows: readonly Record<string, unknown>[];
  /** The key pass's own record of each row, which carries the thread and time. */
  readonly keys: readonly InstantEvalRowKey[];
  /** Why unanswered cells of this page went unjudged, when the page knows. */
  readonly skipReason: string;
  /**
   * Rows a stop reached before their answer did, and the reason to write on
   * them: their cells are null the same way a declined judgement's are.
   */
  readonly unjudgedRows?: {
    readonly indexes: ReadonlySet<number>;
    readonly reason: string;
  };
  readonly now: number;
}): InstantEvalPageMapping {
  const keysByRow = instantEvalKeyIndex(keys);
  const judged = rows.flatMap((row, index) =>
    judgementsForRow({
      tenantId,
      runId,
      questions,
      row,
      keysByRow,
      skipReason: unjudgedRows?.indexes.has(index) ? unjudgedRows.reason : skipReason,
      now,
    }),
  );

  return {
    records: judged.map((one) => one.record),
    counters: tally({ judged, questions, rows: rows.length }),
  };
}

/** What a page's judgements add up to. */
function tally({
  judged,
  questions,
  rows,
}: {
  readonly judged: readonly InstantEvalMappedJudgment[];
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly rows: number;
}): InstantEvalPageCounters {
  const hasBooleanQuestion = questions.some((question) => question.kind === "boolean");

  return {
    rows,
    // Null rather than zero for a run with no boolean question: zero is a real
    // answer ("no row matched") and such a run has no such answer to give.
    matched: hasBooleanQuestion ? judged.filter((one) => one.isBooleanMatch).length : null,
    matchedByQuestion: countPerQuestion({ judged, questions }),
    failed: judged.filter((one) => one.record.Status === "failed").length,
    skipped: judged.filter((one) => one.record.Status === "skipped").length,
  };
}

/** Matches for a boolean question, judged rows for a score or a category one. */
function countPerQuestion({
  judged,
  questions,
}: {
  readonly judged: readonly InstantEvalMappedJudgment[];
  readonly questions: readonly InstantEvalRunQuestion[];
}): Record<string, number> {
  const counts: Record<string, number> = {};
  // Every question gets a key, so a question that matched no row reports a
  // zero rather than an absence a caller has to interpret.
  for (const question of questions) counts[question.id] = 0;
  for (const one of judged) {
    if (!one.countsForQuestion) continue;
    const id = one.record.QuestionId;
    counts[id] = (counts[id] ?? 0) + 1;
  }

  return counts;
}

/** One row's cells as the judgement rows they are written as. */
function judgementsForRow({
  tenantId,
  runId,
  questions,
  row,
  keysByRow,
  skipReason,
  now,
}: {
  readonly tenantId: string;
  readonly runId: string;
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly row: Record<string, unknown>;
  readonly keysByRow: ReadonlyMap<string, InstantEvalRowKey>;
  readonly skipReason: string;
  readonly now: number;
}): InstantEvalMappedJudgment[] {
  const traceId = instantEvalRowText(row, INSTANT_EVAL_TRACE_COLUMN);
  // A row with no trace id has no judgement to address, which the probe makes
  // impossible and the composition does not rely on.
  if (traceId === "") return [];
  const spanId = instantEvalRowText(row, INSTANT_EVAL_SPAN_COLUMN);
  const key = findInstantEvalRowKeys({ row, keysByRow }).at(0);

  return questions.map((question) =>
    judgementFor({
      tenantId,
      runId,
      traceId,
      key,
      question,
      cell: row[question.id],
      spanId,
      skipReason,
      now,
    }),
  );
}

/** What a cell's own status is: answered, lost by the judge, or declined. */
function statusOf({
  answered,
  skipReason,
}: {
  readonly answered: boolean;
  readonly skipReason: string;
}): InstantEvalJudgmentStatus {
  if (answered) return "judged";

  return skipReason === "classifier_failed" ? "failed" : "skipped";
}

/** One cell of one row as the judgement row it is written as. */
function judgementFor({
  tenantId,
  runId,
  traceId,
  key,
  question,
  cell,
  spanId,
  skipReason,
  now,
}: {
  readonly tenantId: string;
  readonly runId: string;
  readonly traceId: string;
  readonly key: InstantEvalRowKey | undefined;
  readonly question: InstantEvalRunQuestion;
  readonly cell: unknown;
  /** The span the row itself named, which is half of the judgement's key. */
  readonly spanId: string;
  readonly skipReason: string;
  readonly now: number;
}): InstantEvalMappedJudgment {
  const answered = isAnswered(cell);
  const verdict = verdictOf({ question, cell });
  const status = statusOf({ answered, skipReason });

  return {
    isBooleanMatch: answered && isBooleanMatch({ question, verdict }),
    countsForQuestion: answered && countsForQuestion({ question, verdict }),
    record: {
      TenantId: tenantId,
      RunId: runId,
      TraceId: traceId,
      QuestionId: question.id,
      ThreadId: key?.threadId ?? "",
      SpanId: spanId || (key?.spanId ?? ""),
      Kind: question.kind,
      Status: status,
      Passed: verdict.passed,
      Score: verdict.score,
      Label: verdict.label,
      Probability: verdict.probability,
      Probabilities: verdict.probabilities,
      Error: answered ? "" : skipReason,
      OccurredAt: key?.occurredAt ?? now,
      CreatedAt: now,
      UpdatedAt: now,
    },
  };
}

/**
 * The share of a page's judgements the judge attempted and lost. Deliberate
 * skips are not in it: a deployment with no classifier skips every text on
 * purpose, and counting that as failure would throw every page forever.
 */
export function instantEvalPageFailureRate({
  counters,
  questions,
}: {
  readonly counters: InstantEvalPageCounters;
  readonly questions: number;
}): number {
  const judgements = counters.rows * questions;
  if (judgements === 0) return 0;

  return counters.failed / judgements;
}
