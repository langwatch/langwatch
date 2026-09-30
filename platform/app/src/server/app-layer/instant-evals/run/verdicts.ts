/**
 * Reading a judged cell as the verdict its question asked for.
 *
 * One reader per `reads`, so the mapping from what the classifier returned to
 * the columns a judgement fills is a table rather than a switch, and adding a
 * question kind is one entry rather than a new branch in the page mapper. The
 * two predicates over a verdict live here for the same reason: what counts as
 * a match is a property of the question's kind, not of the page.
 *
 * @see ./judgments.ts: the page mapping that calls these
 * @see ./questions.ts: where the questions come from
 */

import {
  INSTANT_EVAL_DEFAULT_THRESHOLD,
  type InstantEvalRunQuestion,
} from "./questions";

/** The columns a verdict fills, one kind of question each. */
export interface InstantEvalVerdictColumns {
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
export const EMPTY_VERDICT: InstantEvalVerdictColumns = {
  passed: null,
  score: null,
  label: "",
  probability: null,
  probabilities: "",
};

export const NUMBER_CELL = (cell: unknown): number | null =>
  typeof cell === "number" ? cell : null;

export const TEXT_CELL = (cell: unknown): string | null =>
  typeof cell === "string" && cell !== "" ? cell : null;

/** One reader per `reads`, so the whole mapping is a table rather than a switch. */
export const VERDICT_READERS: Record<
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
export function verdictOf({
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
 * Whether a boolean judgement came back true.
 *
 * Only a boolean question can: it asked something that is either true of the
 * text or not. This is what the run-level `matched` counts, and it is why that
 * number is not the sum of `matchedByQuestion`.
 */
export function isBooleanMatch({
  question,
  verdict,
}: {
  question: InstantEvalRunQuestion;
  verdict: ReturnType<typeof verdictOf>;
}): boolean {
  return question.kind === "boolean" && verdict.passed === 1;
}

/**
 * What a judgement adds to its own question's count.
 *
 * A boolean question counts its trues. A score or category question counts
 * the rows it answered, which is what a caller then groups by label or
 * averages in SQL.
 */
export function countsForQuestion({
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
