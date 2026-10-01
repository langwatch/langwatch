/**
 * What a run asks, read off its row: derived once at creation, so a finished
 * run reports what was asked rather than today's catalog.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import type {
  LangWatchQLJudgementCall,
  LangWatchQLJudgementReading,
} from "@langwatch/analytics-contract";
import type {
  InstantEvalQuestion,
  InstantEvalQuestionKind,
} from "@langwatch/instant-eval-contract";
import { z } from "zod";

/**
 * Where a boolean question with no threshold of its own draws the line: a run
 * has to write a `Passed` somewhere, so it writes one at an even chance and
 * says so. The probability is on every row either way.
 */
export const INSTANT_EVAL_DEFAULT_THRESHOLD = 0.5;

/** One question a run asks, as it is stored on the run. */
export interface InstantEvalRunQuestion {
  /** The statement's own output column, which is the question's name. */
  readonly id: string;
  readonly function: string;
  readonly kind: InstantEvalQuestionKind;
  /** Which part of the verdict the statement's column carries. */
  readonly reads: LangWatchQLJudgementReading;
  /** The question itself, as the judge is asked it. */
  readonly question: InstantEvalQuestion;
  /** Where a boolean question's probability becomes a pass. */
  readonly threshold?: number;
}

const questionKindSchema = z.enum(["boolean", "score", "category"]);

/**
 * The stored shape, read back defensively: a run row survives a catalog
 * change, so a question whose function has since been renamed is still a run
 * that has to read back its counters.
 */
export const instantEvalRunQuestionSchema = z.object({
  id: z.string().min(1),
  function: z.string().min(1),
  kind: questionKindSchema,
  reads: z.enum(["probability", "passed", "score", "label", "probabilities"]),
  question: z.object({ id: z.string(), kind: questionKindSchema }).passthrough(),
  threshold: z.number().optional(),
});

export const instantEvalRunQuestionsSchema = z.array(instantEvalRunQuestionSchema);

/** The questions stored on a run, or none when the column is unreadable. */
export function readInstantEvalRunQuestions(stored: unknown): readonly InstantEvalRunQuestion[] {
  const parsed = instantEvalRunQuestionsSchema.safeParse(stored);
  if (!parsed.success) return [];
  // Rebuilt field by field: the schema reads the question itself loosely, so
  // its parsed type is wider than the union the judge takes, and only the
  // kind decides which member it is.
  return parsed.data.map((entry) => ({
    id: entry.id,
    function: entry.function,
    kind: entry.kind,
    reads: entry.reads,
    question: questionOf(entry),
    ...(entry.threshold === undefined ? {} : { threshold: entry.threshold }),
  }));
}

/** The stored question, narrowed by its kind. */
function questionOf(entry: {
  kind: InstantEvalQuestionKind;
  question: Record<string, unknown>;
}): InstantEvalQuestion {
  const stored = entry.question;
  const id = typeof stored.id === "string" ? stored.id : "";
  const instructions = typeof stored.instructions === "string" ? stored.instructions : "";
  if (entry.kind === "score") {
    return { id, kind: "score", instructions, range: rangeOf(stored.range) };
  }
  if (entry.kind === "category") {
    return { id, kind: "category", instructions, options: optionsOf(stored.options) };
  }
  const [criteria] = findCriteria(stored.criteria);
  return { id, kind: "boolean", instructions, ...(criteria ? { criteria } : {}) };
}

function rangeOf(value: unknown): { min: number; max: number } {
  const parsed = z.object({ min: z.number(), max: z.number() }).safeParse(value);
  return parsed.success ? parsed.data : { min: 0, max: 1 };
}

function optionsOf(value: unknown): readonly { name: string; description: string }[] {
  const parsed = z.array(z.object({ name: z.string(), description: z.string() })).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** The two sides of a boundary, or none when the column carries neither. */
function findCriteria(value: unknown): (readonly [string, string])[] {
  const parsed = z.tuple([z.string(), z.string()]).safeParse(value);
  return parsed.success ? [parsed.data] : [];
}

/** One judged column of the statement, as the run stores what it asked. */
function runQuestionOf(call: LangWatchQLJudgementCall): InstantEvalRunQuestion {
  return {
    id: call.column,
    function: call.function,
    kind: call.kind,
    reads: call.reads,
    question: askedQuestionOf(call),
    ...(call.threshold === undefined ? {} : { threshold: call.threshold }),
  };
}

/** The same question, addressed to the judge by the column it comes back in. */
function askedQuestionOf(call: LangWatchQLJudgementCall): InstantEvalQuestion {
  const { column: id, instructions } = call;
  if (call.kind === "score") return { id, kind: "score", instructions, range: call.range };
  if (call.kind === "category") {
    return { id, kind: "category", instructions, options: call.options };
  }

  return {
    id,
    kind: "boolean",
    instructions,
    ...(call.criteria ? { criteria: call.criteria } : {}),
  };
}

/**
 * The questions a validated statement asks, in projection order. Empty for a
 * statement that projects no eval function, which is what the create path
 * refuses on: a run with no question would judge nothing and cost nothing.
 */
export function instantEvalRunQuestions(
  judgements: readonly LangWatchQLJudgementCall[],
): readonly InstantEvalRunQuestion[] {
  return judgements.map(runQuestionOf);
}
