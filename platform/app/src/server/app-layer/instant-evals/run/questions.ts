/**
 * What a run asks, read off the statement it was created from.
 *
 * A run's questions are not a field a caller sends. They are the eval functions
 * the statement projects, and they are derived once at creation and stored on
 * the run, so that reading a finished run six months later reports what was
 * asked rather than what the catalog would make of the same text today.
 *
 * The question id is the output column the caller aliased the call to. It is
 * unique within a statement, it is what the judged cell comes back in, and it
 * is what the judgement row is keyed by, so the whole chain from SQL to
 * ClickHouse addresses a question by the same name the caller wrote.
 *
 * @see ~/server/analytics/lwql/appFunctions/evalQuestions.ts: the same
 *   translation for the synchronous path
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { z } from "zod";

import {
  instantEvalQuestionFor,
  type LangWatchQLAppFunctionCall,
  type LangWatchQLAppFunctionOption,
  type LangWatchQLJudgementReading,
  lwqlAppFunction,
} from "~/server/analytics/lwql";
import type {
  InstantEvalQuestion,
  InstantEvalQuestionKind,
} from "../classifier/classifier";

/**
 * Where a boolean question with no threshold of its own draws the line.
 *
 * `eval` answers a calibrated probability and names no threshold, because the
 * caller reading the column picks their own. A run has to write a `Passed`
 * somewhere, so it writes one at an even chance and says so: `eval_passed`
 * exists for a caller who wants the line drawn elsewhere, and the probability
 * is on every row either way.
 */
export const INSTANT_EVAL_DEFAULT_THRESHOLD = 0.5;

/** One question a run asks, as it is stored on the run. */
export interface InstantEvalRunQuestion {
  /** The statement's own output column, which is the question's name. */
  readonly id: string;
  /** The eval function that asked it. */
  readonly function: string;
  readonly kind: InstantEvalQuestionKind;
  /** Which part of the verdict the statement's column carries. */
  readonly reads: LangWatchQLJudgementReading;
  /** The question itself, as the classifier is asked it. */
  readonly question: InstantEvalQuestion;
  /** Where a boolean question's probability becomes a pass. */
  readonly threshold?: number;
}

const questionKindSchema = z.enum(["boolean", "score", "category"]);

/**
 * The stored shape, read back defensively.
 *
 * A run row survives a catalog change, so the JSON column is parsed rather
 * than cast: a question whose function has since been renamed is a run that
 * still has to read back its counters.
 */
export const instantEvalRunQuestionSchema = z.object({
  id: z.string().min(1),
  function: z.string().min(1),
  kind: questionKindSchema,
  reads: z.enum(["probability", "passed", "score", "label", "probabilities"]),
  question: z
    .object({ id: z.string(), kind: questionKindSchema })
    .passthrough(),
  threshold: z.number().optional(),
}) satisfies z.ZodType<unknown>;

export const instantEvalRunQuestionsSchema = z.array(
  instantEvalRunQuestionSchema,
);

/** The option a parameter name declares on this function, or `undefined`. */
function optionNamed({
  functionName,
  options,
  name,
}: {
  functionName: string;
  options: readonly LangWatchQLAppFunctionOption[];
  name: string;
}): LangWatchQLAppFunctionOption | undefined {
  const definition = lwqlAppFunction(functionName);
  if (!definition) return undefined;
  const index = definition.parameters
    .filter((parameter) => parameter.role === "option")
    .findIndex((parameter) => parameter.name === name);
  return index < 0 ? undefined : options[index];
}

/** The line a boolean question's probability has to clear to count as passed. */
function thresholdFor({
  functionName,
  options,
}: {
  functionName: string;
  options: readonly LangWatchQLAppFunctionOption[];
}): number {
  const declared = optionNamed({ functionName, options, name: "threshold" });
  return typeof declared === "number"
    ? declared
    : INSTANT_EVAL_DEFAULT_THRESHOLD;
}

/**
 * The questions a validated statement asks.
 *
 * Empty for a statement that projects no eval function, which is what the
 * create path refuses on: a run with no question would judge nothing and cost
 * nothing, and answering it 202 would be a job that never had anything to do.
 */
export function instantEvalRunQuestions(
  calls: readonly LangWatchQLAppFunctionCall[],
): readonly InstantEvalRunQuestion[] {
  const questions: InstantEvalRunQuestion[] = [];
  for (const call of calls) {
    const definition = lwqlAppFunction(call.function);
    if (!definition?.judgement) continue;
    questions.push({
      id: call.column,
      function: definition.name,
      kind: definition.judgement.kind,
      reads: definition.judgement.reads,
      question: instantEvalQuestionFor({
        definition,
        options: call.options,
        column: call.column,
      }),
      ...(definition.judgement.kind === "boolean"
        ? {
            threshold: thresholdFor({
              functionName: definition.name,
              options: call.options,
            }),
          }
        : {}),
    });
  }
  return questions;
}

/** The questions stored on a run, or an empty list when the column is unreadable. */
export function readInstantEvalRunQuestions(
  stored: unknown,
): readonly InstantEvalRunQuestion[] {
  const parsed = instantEvalRunQuestionsSchema.safeParse(stored);
  if (!parsed.success) return [];
  // Rebuilt field by field rather than cast: the schema deliberately reads the
  // question itself loosely, so its parsed type is wider than the union the
  // classifier takes and only the kind decides which member it is.
  return parsed.data.map((entry) => ({
    id: entry.id,
    function: entry.function,
    kind: entry.kind,
    reads: entry.reads,
    question: entry.question as unknown as InstantEvalQuestion,
    ...(entry.threshold === undefined ? {} : { threshold: entry.threshold }),
  }));
}
