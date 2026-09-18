/**
 * A judged page, turned into the rows that are kept and the numbers that are
 * reported.
 *
 * The page pass came back with one row per judged text and one column per
 * question; the judgements table is one row per text per question. This module
 * is that transposition, and the only place that knows which part of a verdict
 * each eval function's column carries.
 *
 * Nothing here holds the text that was judged. The row carries the verdict and
 * the ids it belongs to, and reading the text back is the sample endpoint's job.
 *
 * @see ./questions.ts: where the questions come from
 * @see ./verdicts.ts: how one judged cell is read
 * @see ../../../clickhouse/migrations/00097_create_instant_eval_judgments.sql
 */

import {
  INSTANT_EVAL_SPAN_COLUMN,
  INSTANT_EVAL_TRACE_COLUMN,
} from "./composition";
import type { InstantEvalRunQuestion } from "./questions";
import type { InstantEvalRowKey } from "./row-source";
import { countsForQuestion, isBooleanMatch, verdictOf } from "./verdicts";

/** Whether a judgement was made, declined, or attempted and lost. */
export const INSTANT_EVAL_JUDGMENT_STATUSES = [
  "judged",
  "skipped",
  "failed",
] as const;

export type InstantEvalJudgmentStatus =
  (typeof INSTANT_EVAL_JUDGMENT_STATUSES)[number];

/** One row of `instant_eval_judgments`, in the table's own spelling. */
export interface InstantEvalJudgmentRecord {
  readonly TenantId: string;
  readonly RunId: string;
  readonly TraceId: string;
  readonly QuestionId: string;
  readonly ThreadId: string;
  readonly SpanId: string;
  readonly Kind: string;
  readonly Status: InstantEvalJudgmentStatus;
  readonly Passed: number | null;
  readonly Score: number | null;
  readonly Label: string;
  readonly Probability: number | null;
  readonly Probabilities: string;
  readonly Error: string;
  readonly OccurredAt: number;
  readonly CreatedAt: number;
  readonly UpdatedAt: number;
}

/** What one page added to a run's running totals. */
export interface InstantEvalPageCounters {
  /** Rows judged, which is rows of the page that came back. */
  readonly rows: number;
  /** Judgements that matched, across every question. */
  /**
   * Judgements that matched, across the run's BOOLEAN questions only.
   *
   * A boolean question asked something that is either true of the text or
   * not, so counting the trues is a number that means something. A score and
   * a category have no "yes", and adding their judged rows in here would make
   * the headline count read as "matches" while being mostly "rows we looked
   * at". Null when the run asked no boolean question at all.
   */
  readonly matched: number | null;
  /**
   * Per question: matches for a boolean one, judged rows for the others.
   *
   * The per-question number is what a caller reads beside the question, where
   * the kind is right there and the meaning is unambiguous.
   */
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  /** Judgements the judge attempted and lost. */
  readonly failed: number;
  /** Judgements the judge declined to make. */
  readonly skipped: number;
}

/**
 * Whether a cell means the judge answered.
 *
 * Null is the skip: hydration leaves a cell null when the classifier declined
 * the text or could not be reached for it, and the reason is reported for the
 * page as a whole rather than per cell, because one request answers every
 * question about one text.
 */
function isAnswered(cell: unknown): boolean {
  return cell !== null && cell !== undefined && cell !== "";
}

/** One judged cell, as the page mapping produced it. */
interface InstantEvalMappedJudgment {
  readonly record: InstantEvalJudgmentRecord;
  /** Whether a boolean question came back true. Feeds the run's own total. */
  readonly isBooleanMatch: boolean;
  /** Whether it counts toward its own question's number. */
  readonly countsForQuestion: boolean;
}

export interface InstantEvalPageMapping {
  readonly records: readonly InstantEvalJudgmentRecord[];
  readonly counters: InstantEvalPageCounters;
}

/**
 * The reason a page's unjudged cells carry.
 *
 * One reason for the page rather than one per row, because that is the grain
 * the classifier reports at: it answers per text, and the hydration stage hands
 * back how many texts each reason accounted for, not which. Where a page saw
 * several reasons the commonest one is written, which describes a page that
 * mostly hit one wall. `classifier_failed` breaks a tie, so a page that lost
 * rows is never reported as having declined them.
 */
export function instantEvalSkipReason(
  skipped: Readonly<Record<string, number>>,
): string {
  const entries = Object.entries(skipped);
  if (entries.length === 0) return "";
  let best = entries[0] as [string, number];
  for (const entry of entries.slice(1)) {
    const isMoreCommon = entry[1] > best[1];
    const breaksTieAsFailure =
      entry[1] === best[1] && entry[0] === "classifier_failed";
    if (isMoreCommon || breaksTieAsFailure) best = entry as [string, number];
  }
  return best[0];
}

/**
 * One page's rows as judgements and counters.
 *
 * `skipReason` is the page's dominant skip, as the hydration stage reported it,
 * and it is written onto the rows that have no verdict. A single reason for the
 * page rather than one per row is what the classifier's contract offers: it
 * reports a skip per text, and every question of that text shares it.
 */
export function mapInstantEvalPage({
  tenantId,
  runId,
  questions,
  rows,
  keys,
  skipReason,
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
  readonly now: number;
}): InstantEvalPageMapping {
  const keysByRow = instantEvalKeyIndex(keys);
  const judged = rows.flatMap((row) =>
    judgementsForRow({
      tenantId,
      runId,
      questions,
      row,
      keysByRow,
      skipReason,
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
  const hasBooleanQuestion = questions.some(
    (question) => question.kind === "boolean",
  );
  return {
    rows,
    // Null rather than zero for a run with no boolean question: zero is a real
    // answer ("no row matched") and such a run has no such answer to give.
    matched: hasBooleanQuestion
      ? judged.filter((one) => one.isBooleanMatch).length
      : null,
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
  // Every question of the run gets a key, so a page where one question matched
  // no row reports a zero rather than an absence a caller has to interpret.
  for (const question of questions) counts[question.id] = 0;
  for (const one of judged) {
    if (!one.countsForQuestion) continue;
    const id = one.record.QuestionId;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * The page's keys, indexed by whatever addresses one of its rows.
 *
 * The trace and span pair when the statement projects `SpanId`, which is how
 * a statement over spans has several rows per trace, and the trace alone
 * otherwise. The same choice keys the judgement row, so a lookup that finds
 * the key and a write that addresses the judgement agree by construction.
 */
export function instantEvalKeyIndex(
  keys: readonly InstantEvalRowKey[],
): ReadonlyMap<string, InstantEvalRowKey> {
  const bySpan = keys.some((key) => key.spanId !== "");
  return new Map(
    keys.map((key) => [
      bySpan ? rowAddress(key.traceId, key.spanId) : key.traceId,
      key,
    ]),
  );
}

/** One row's address within a page, as a single map key. */
function rowAddress(traceId: string, spanId: string): string {
  return `${traceId}\u0000${spanId}`;
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
  const traceId = String(row[INSTANT_EVAL_TRACE_COLUMN] ?? "");
  // A row with no trace id has no judgement to address, which the probe makes
  // impossible and the composition does not rely on.
  if (traceId === "") return [];
  const spanId = String(row[INSTANT_EVAL_SPAN_COLUMN] ?? "");
  const key =
    keysByRow.get(rowAddress(traceId, spanId)) ?? keysByRow.get(traceId);

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
  const status: InstantEvalJudgmentStatus = answered
    ? "judged"
    : skipReason === "classifier_failed"
      ? "failed"
      : "skipped";

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
 * The share of a page's judgements the judge attempted and lost.
 *
 * Deliberate skips are not in it, and that is the distinction the whole
 * redelivery rule rests on: a deployment with no classifier configured skips
 * every text on purpose, and treating that as a failure would make every page
 * of every run throw forever. A failure is a judge that was reachable, was
 * asked, and did not answer.
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

/**
 * The share of a page's judgements past which the page is thrown back to the
 * queue rather than recorded.
 *
 * Half: below it the page is a real answer with some rows the judge lost, and
 * recording it with its failures counted is more useful than losing the rows
 * that did come back. Above it the page is mostly nothing, and recording it
 * would bake a bad minute of the provider's day into the run's answer.
 */
export const INSTANT_EVAL_PAGE_FAILURE_CEILING = 0.5;
