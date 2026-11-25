/**
 * Which `eval` chips are surely Instant Evals, and the mark a submitted question leaves.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { INSTANT_EVAL_TARGET_FIELDS } from "@langwatch/trace-contract";

/**
 * The mark of a question submitted as an Instant Eval: by project, so another project's bare chip
 * keeps its older meaning, and not by window, so a new range keeps the chip pending.
 */
export function typedQuestionKey({
  projectId,
  question,
}: {
  projectId: string;
  question: string;
}): string {
  return JSON.stringify([projectId, question.replace(/\s+/g, " ").trim()]);
}

/**
 * Whether a chip is surely an Instant Eval rather than an older bare evaluator name: it forces a
 * target, was submitted here as one in this project, or has a run registered under its key.
 */
export function isSurelyInstantEvalChip({
  chip,
  projectId,
  typedQuestions,
  runsByKey,
}: {
  chip: { field: string; question: string; key: string };
  projectId: string;
  typedQuestions: Readonly<Record<string, true>>;
  runsByKey: Readonly<Record<string, string>> | undefined;
}): boolean {
  return (
    Object.hasOwn(INSTANT_EVAL_TARGET_FIELDS, chip.field) ||
    Boolean(typedQuestions[typedQuestionKey({ projectId, question: chip.question })]) ||
    Boolean(runsByKey?.[chip.key])
  );
}

/** What the submit toast and the empty table both say about a `NOT` no run can answer. */
export const UNJUDGEABLE_NOT_COPY = {
  title: "This NOT cannot be judged as typed",
  description:
    "An Instant Eval judges only the rows the other terms keep. " +
    'Rewrite the NOT beside them with AND, as in status:error AND NOT eval:"...".',
} as const;
