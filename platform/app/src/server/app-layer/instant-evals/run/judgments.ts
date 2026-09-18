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
 * @see ../../../clickhouse/migrations/00097_create_instant_eval_judgments.sql
 */

import { INSTANT_EVAL_TRACE_COLUMN } from "./composition";
import {
  INSTANT_EVAL_DEFAULT_THRESHOLD,
  type InstantEvalRunQuestion,
} from "./questions";
import type { InstantEvalRowKey } from "./row-source";

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
  readonly matched: number;
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  /** Judgements the judge attempted and lost. */
  readonly failed: number;
  /** Judgements the judge declined to make. */
  readonly skipped: number;
}

/** The columns a verdict fills, one kind of question each. */
interface InstantEvalVerdictColumns {
  readonly passed: number | null;
  readonly score: number | null;
  readonly label: string;
  readonly probability: number | null;
  readonly probabilities: string;
}

/**
 * A verdict that fills none of them.
 *
 * Also the answer for a cell whose type does not match what its question
 * reads. That is not defensive padding: hydration writes whatever the
 * classifier returned, and a column read as a score that came back a string
 * has no score in it. Writing the empty verdict records the judgement as
 * present with no value rather than inventing a zero.
 */
const EMPTY_VERDICT: InstantEvalVerdictColumns = {
  passed: null,
  score: null,
  label: "",
  probability: null,
  probabilities: "",
};

const NUMBER_CELL = (cell: unknown): number | null =>
  typeof cell === "number" ? cell : null;

const TEXT_CELL = (cell: unknown): string | null =>
  typeof cell === "string" && cell !== "" ? cell : null;

/** One reader per `reads`, so the whole mapping is a table rather than a switch. */
const VERDICT_READERS: Record<
  InstantEvalRunQuestion["reads"],
  (input: {
    cell: unknown;
    question: InstantEvalRunQuestion;
  }) => InstantEvalVerdictColumns
> = {
  probability: ({ cell, question }) => {
    const probability = NUMBER_CELL(cell);
    if (probability === null) return EMPTY_VERDICT;
    const threshold = question.threshold ?? INSTANT_EVAL_DEFAULT_THRESHOLD;
    return {
      ...EMPTY_VERDICT,
      probability,
      passed: probability >= threshold ? 1 : 0,
    };
  },
  passed: ({ cell }) => ({ ...EMPTY_VERDICT, passed: NUMBER_CELL(cell) }),
  score: ({ cell }) => ({ ...EMPTY_VERDICT, score: NUMBER_CELL(cell) }),
  label: ({ cell }) => ({
    ...EMPTY_VERDICT,
    label: TEXT_CELL(cell) ?? "",
  }),
  probabilities: ({ cell }) => ({
    ...EMPTY_VERDICT,
    probabilities: TEXT_CELL(cell) ?? "",
  }),
};

/** The verdict a cell carries, read according to what its question publishes. */
function verdictOf({
  question,
  cell,
}: {
  question: InstantEvalRunQuestion;
  cell: unknown;
}): InstantEvalVerdictColumns {
  return (VERDICT_READERS[question.reads] ?? VERDICT_READERS.probabilities)({
    cell,
    question,
  });
}

/**
 * Whether a judgement counts as a match.
 *
 * Only a boolean question has matches: it asked something that is either true
 * of the text or not, and the run's headline number is how many were. A score
 * and a category have no "yes" to count, so for them the number a run reports
 * per question is how many rows were judged at all, which is what a caller
 * then groups by label or averages in SQL.
 */
function isMatch({
  question,
  verdict,
}: {
  question: InstantEvalRunQuestion;
  verdict: ReturnType<typeof verdictOf>;
}): boolean {
  if (question.kind === "boolean") return verdict.passed === 1;
  return (
    verdict.score !== null ||
    verdict.label !== "" ||
    verdict.probabilities !== ""
  );
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
 * several reasons the commonest one is written, which is the honest summary of
 * a page that mostly hit one wall. `classifier_failed` breaks a tie, so a page
 * that lost rows is never reported as having declined them.
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
  keysByTraceId,
  skipReason,
  now,
}: {
  readonly tenantId: string;
  readonly runId: string;
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly rows: readonly Record<string, unknown>[];
  /** The key pass's own record of each row, which carries the thread and time. */
  readonly keysByTraceId: ReadonlyMap<string, InstantEvalRowKey>;
  /** Why unanswered cells of this page went unjudged, when the page knows. */
  readonly skipReason: string;
  readonly now: number;
}): InstantEvalPageMapping {
  const records: InstantEvalJudgmentRecord[] = [];
  const matchedByQuestion: Record<string, number> = {};
  let matched = 0;
  let failed = 0;
  let skipped = 0;

  // Every question of the run gets a key, so a page where one question matched
  // nothing reports a zero rather than an absence a caller has to interpret.
  for (const question of questions) matchedByQuestion[question.id] ??= 0;

  const judged = rows.flatMap((row) =>
    judgementsForRow({
      tenantId,
      runId,
      questions,
      row,
      keysByTraceId,
      skipReason,
      now,
    }),
  );

  for (const one of judged) {
    records.push(one.record);
    if (one.record.Status === "failed") failed += 1;
    if (one.record.Status === "skipped") skipped += 1;
    if (one.isMatch) {
      matched += 1;
      const id = one.record.QuestionId;
      matchedByQuestion[id] = (matchedByQuestion[id] ?? 0) + 1;
    }
  }

  return {
    records,
    counters: {
      rows: rows.length,
      matched,
      matchedByQuestion,
      failed,
      skipped,
    },
  };
}

/** One row's cells as the judgement rows they are written as. */
function judgementsForRow({
  tenantId,
  runId,
  questions,
  row,
  keysByTraceId,
  skipReason,
  now,
}: {
  readonly tenantId: string;
  readonly runId: string;
  readonly questions: readonly InstantEvalRunQuestion[];
  readonly row: Record<string, unknown>;
  readonly keysByTraceId: ReadonlyMap<string, InstantEvalRowKey>;
  readonly skipReason: string;
  readonly now: number;
}): { record: InstantEvalJudgmentRecord; isMatch: boolean }[] {
  const traceId = String(row[INSTANT_EVAL_TRACE_COLUMN] ?? "");
  // A row with no trace id has no judgement to address, which the probe makes
  // impossible and the composition does not rely on.
  if (traceId === "") return [];
  const key = keysByTraceId.get(traceId);

  return questions.map((question) =>
    judgementFor({
      tenantId,
      runId,
      traceId,
      key,
      question,
      cell: row[question.id],
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
  skipReason,
  now,
}: {
  readonly tenantId: string;
  readonly runId: string;
  readonly traceId: string;
  readonly key: InstantEvalRowKey | undefined;
  readonly question: InstantEvalRunQuestion;
  readonly cell: unknown;
  readonly skipReason: string;
  readonly now: number;
}): { record: InstantEvalJudgmentRecord; isMatch: boolean } {
  const answered = isAnswered(cell);
  const verdict = verdictOf({ question, cell });
  const status: InstantEvalJudgmentStatus = answered
    ? "judged"
    : skipReason === "classifier_failed"
      ? "failed"
      : "skipped";

  return {
    isMatch: answered && isMatch({ question, verdict }),
    record: {
      TenantId: tenantId,
      RunId: runId,
      TraceId: traceId,
      QuestionId: question.id,
      ThreadId: key?.threadId ?? "",
      SpanId: key?.spanId ?? "",
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
