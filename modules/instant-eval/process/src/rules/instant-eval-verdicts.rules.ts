/**
 * A judged cell and the verdict its question asked for, each read from the
 * other: one entry per `reads`, so a new question kind is two table rows
 * rather than two new branches.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { InstantEvalVerdict } from "@langwatch/instant-eval-contract";

import {
  INSTANT_EVAL_DEFAULT_THRESHOLD,
  type InstantEvalRunQuestion,
} from "./instant-eval-run-questions.rules.ts";

/** The columns a verdict fills, one kind of question each. */
export interface InstantEvalVerdictColumns {
  readonly passed: number | null;
  readonly score: number | null;
  readonly label: string;
  readonly probability: number | null;
  readonly probabilities: string;
}

/**
 * A verdict that fills none of them — also the answer for a cell whose type
 * does not match what its question reads, which records the judgement as
 * present with no value rather than inventing a zero.
 */
export const EMPTY_INSTANT_EVAL_VERDICT: InstantEvalVerdictColumns = {
  passed: null,
  score: null,
  label: "",
  probability: null,
  probabilities: "",
};

const numberCell = (cell: unknown): number | null => (typeof cell === "number" ? cell : null);

const textCell = (cell: unknown): string => (typeof cell === "string" && cell !== "" ? cell : "");

/** One reader per `reads`, so the whole mapping is a table rather than a switch. */
const VERDICT_READERS: Record<
  InstantEvalRunQuestion["reads"],
  (input: { cell: unknown; question: InstantEvalRunQuestion }) => InstantEvalVerdictColumns
> = {
  probability: ({ cell, question }) => {
    const probability = numberCell(cell);
    if (probability === null) return EMPTY_INSTANT_EVAL_VERDICT;
    const threshold = question.threshold ?? INSTANT_EVAL_DEFAULT_THRESHOLD;

    return {
      ...EMPTY_INSTANT_EVAL_VERDICT,
      probability,
      passed: probability >= threshold ? 1 : 0,
    };
  },
  passed: ({ cell }) => ({ ...EMPTY_INSTANT_EVAL_VERDICT, passed: numberCell(cell) }),
  score: ({ cell }) => ({ ...EMPTY_INSTANT_EVAL_VERDICT, score: numberCell(cell) }),
  label: ({ cell }) => ({ ...EMPTY_INSTANT_EVAL_VERDICT, label: textCell(cell) }),
  probabilities: ({ cell }) => ({
    ...EMPTY_INSTANT_EVAL_VERDICT,
    probabilities: textCell(cell),
  }),
};

/** The verdict a cell carries, read according to what its question publishes. */
export function verdictOf({
  question,
  cell,
}: {
  question: InstantEvalRunQuestion;
  cell: unknown;
}): InstantEvalVerdictColumns {
  return VERDICT_READERS[question.reads]({ cell, question });
}

/** One writer per `reads`: the same table, read the other way. */
const VERDICT_WRITERS: Record<
  InstantEvalRunQuestion["reads"],
  (input: {
    verdict: InstantEvalVerdict;
    question: InstantEvalRunQuestion;
  }) => string | number | null
> = {
  probability: ({ verdict }) => verdict.probability ?? null,
  passed: ({ verdict, question }) => {
    if (verdict.probability === undefined) return null;

    return verdict.probability >= (question.threshold ?? INSTANT_EVAL_DEFAULT_THRESHOLD) ? 1 : 0;
  },
  score: ({ verdict }) => verdict.score ?? null,
  label: ({ verdict }) => verdict.label ?? null,
  probabilities: ({ verdict }) =>
    verdict.probabilities ? JSON.stringify(verdict.probabilities) : null,
};

/**
 * What a question's own column holds, given the verdict it got. A null cell is
 * a value the row carries, not an absence, so it travels in a named field.
 */
export function instantEvalJudgedCellFor({
  question,
  verdict,
}: {
  question: InstantEvalRunQuestion;
  verdict: InstantEvalVerdict | undefined;
}): { cell: string | number | null } {
  if (!verdict) return { cell: null };

  return { cell: VERDICT_WRITERS[question.reads]({ verdict, question }) };
}

/**
 * Whether a boolean judgement came back true. Only a boolean question can,
 * which is what the run-level `matched` counts — and why that number is not
 * the sum of `matchedByQuestion`.
 */
export function isBooleanMatch({
  question,
  verdict,
}: {
  question: InstantEvalRunQuestion;
  verdict: InstantEvalVerdictColumns;
}): boolean {
  return question.kind === "boolean" && verdict.passed === 1;
}

/**
 * What a judgement adds to its own question's count: a boolean question counts
 * its trues, a score or category question counts the rows it answered.
 */
export function countsForQuestion({
  question,
  verdict,
}: {
  question: InstantEvalRunQuestion;
  verdict: InstantEvalVerdictColumns;
}): boolean {
  if (question.kind === "boolean") return verdict.passed === 1;

  return verdict.score !== null || verdict.label !== "" || verdict.probabilities !== "";
}
