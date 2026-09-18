/**
 * Instant Evals questions on the wire, and the answers read back off it.
 *
 * The classifier speaks three question types and this module is the only place
 * that knows their names. Our vocabulary is the one customers already have from
 * the `llm_boolean`, `llm_score` and `llm_category` evaluators — `instructions`
 * is the prompt, `options` are the categories — and it maps one to one:
 *
 * | Ours | Theirs | What comes back |
 * |---|---|---|
 * | `boolean` | `noul` | a calibrated probability of yes |
 * | `score` | `score` | a distribution over the levels we listed |
 * | `category` | `choice` | a distribution over the options we listed |
 *
 * Two readings are ours rather than theirs, and both are deliberate. A score is
 * the **probability-weighted mean of the levels**, not the top level, because a
 * distribution split evenly between 2 and 4 means 3 and picking either endpoint
 * would be a worse answer than the one we can compute. A category's label is
 * the argmax with its own probability kept beside it, so a caller can tell a
 * confident answer from a coin flip.
 *
 * Answers are matched to questions **by id**, never by position: the response is
 * an object keyed by the ids we sent, and reading it positionally would put one
 * question's verdict in another's column on any response that reorders.
 *
 * @see ./classifier.ts
 * @see ../../../../../specs/instant-evals/classifier.feature
 */

import { z } from "zod";

import type {
  InstantEvalCategoryQuestion,
  InstantEvalQuestion,
  InstantEvalScoreQuestion,
  InstantEvalVerdict,
} from "./classifier";

// ---------------------------------------------------------------------------
// Our questions
// ---------------------------------------------------------------------------

const instructionsSchema = z.string().trim().min(1).max(4_000);

export const instantEvalBooleanQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("boolean"),
  instructions: instructionsSchema,
  criteria: z.tuple([instructionsSchema, instructionsSchema]).optional(),
});

export const instantEvalScoreQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("score"),
  instructions: instructionsSchema,
  range: z
    .object({ min: z.number().int(), max: z.number().int() })
    .refine(({ min, max }) => max > min, {
      message: "the maximum must be above the minimum",
    }),
});

export const instantEvalCategoryQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("category"),
  instructions: instructionsSchema,
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(2_000),
      }),
    )
    .min(2)
    .max(255),
});

export const instantEvalQuestionSchema = z.discriminatedUnion("kind", [
  instantEvalBooleanQuestionSchema,
  instantEvalScoreQuestionSchema,
  instantEvalCategoryQuestionSchema,
]);

/** The levels a score question offers, low to high. */
export function instantEvalScoreLevels(
  question: InstantEvalScoreQuestion,
): number[] {
  const { min, max } = question.range;
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

// ---------------------------------------------------------------------------
// Their request
// ---------------------------------------------------------------------------

/** One question as the classifier takes it. */
export type ClassifierWireQuestion = Readonly<Record<string, unknown>>;

/** Every question of one request, keyed by our own question ids. */
export function toClassifierQuestions(
  questions: readonly InstantEvalQuestion[],
): Record<string, ClassifierWireQuestion> {
  const wire: Record<string, ClassifierWireQuestion> = {};
  for (const question of questions) {
    wire[question.id] = toClassifierQuestion(question);
  }
  return wire;
}

function toClassifierQuestion(
  question: InstantEvalQuestion,
): ClassifierWireQuestion {
  if (question.kind === "boolean") {
    const { criteria } = question;
    return {
      type: "noul",
      instructions: question.instructions,
      // The classifier names the two sides `true` and `false`, so the pair is
      // spread onto those keys rather than sent as a list it would refuse.
      ...(criteria
        ? { criteria: { true: criteria[0], false: criteria[1] } }
        : {}),
    };
  }
  if (question.kind === "score") {
    return {
      type: "score",
      instructions: question.instructions,
      criteria: instantEvalScoreLevels(question).map(String),
    };
  }
  return {
    type: "choice",
    instructions: question.instructions,
    criteria: categoryCriteria(question),
  };
}

function categoryCriteria(
  question: InstantEvalCategoryQuestion,
): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const option of question.options)
    criteria[option.name] = option.description;
  return criteria;
}

// ---------------------------------------------------------------------------
// Their response
// ---------------------------------------------------------------------------

const answerSchema = z.object({
  type: z.string().optional(),
  noul: z.number().optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});

export const classifierResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

export type ClassifierResponse = z.infer<typeof classifierResponseSchema>;
type ClassifierAnswer = z.infer<typeof answerSchema>;

/**
 * One verdict per question, read from the answer that question's id names.
 *
 * A question with no answer is dropped rather than defaulted: a missing verdict
 * leaves its cell null with a diagnostic, while a defaulted one would put a
 * number in front of a customer that nothing computed.
 */
export function readClassifierVerdicts({
  questions,
  response,
}: {
  questions: readonly InstantEvalQuestion[];
  response: ClassifierResponse;
}): InstantEvalVerdict[] {
  const verdicts: InstantEvalVerdict[] = [];
  for (const question of questions) {
    const answer = response.answers[question.id];
    if (!answer) continue;
    const verdict = readVerdict({ question, answer });
    if (verdict) verdicts.push(verdict);
  }
  return verdicts;
}

function readVerdict({
  question,
  answer,
}: {
  question: InstantEvalQuestion;
  answer: ClassifierAnswer;
}): InstantEvalVerdict | null {
  if (question.kind === "boolean") {
    return typeof answer.noul === "number"
      ? { questionId: question.id, probability: answer.noul }
      : null;
  }
  if (question.kind === "score") {
    const score = weightedScore({ question, answer });
    return score === null ? null : { questionId: question.id, score };
  }
  return readCategoryVerdict({ question, answer });
}

/**
 * The probability-weighted mean of a score question's levels.
 *
 * The classifier answers with a distribution over the level *positions* it was
 * given, and `score` is that distribution's mean position. Reading the
 * distribution ourselves rather than trusting the mean keeps the two in step
 * when one of them is missing, and both come out at the same number: a
 * distribution of 0.06, 0.63, 0.30, 0.01 over the range one to five is 2.26
 * either way.
 */
function weightedScore({
  question,
  answer,
}: {
  question: InstantEvalScoreQuestion;
  answer: ClassifierAnswer;
}): number | null {
  const levels = instantEvalScoreLevels(question);
  const { probabilities } = answer;
  if (probabilities) {
    let total = 0;
    let weight = 0;
    for (const [position, probability] of Object.entries(probabilities)) {
      const level = levels[Number(position)];
      if (level === undefined) continue;
      total += level * probability;
      weight += probability;
    }
    if (weight > 0) return total / weight;
  }
  return typeof answer.score === "number"
    ? question.range.min + answer.score
    : null;
}

function readCategoryVerdict({
  question,
  answer,
}: {
  question: InstantEvalCategoryQuestion;
  answer: ClassifierAnswer;
}): InstantEvalVerdict | null {
  const names = new Set(question.options.map((option) => option.name));
  const probabilities = Object.fromEntries(
    Object.entries(answer.probabilities ?? {}).filter(([name]) =>
      names.has(name),
    ),
  );
  const label =
    answer.choice && names.has(answer.choice)
      ? answer.choice
      : mostLikely(probabilities);
  if (label === null) return null;
  return {
    questionId: question.id,
    label,
    ...(Object.keys(probabilities).length > 0 ? { probabilities } : {}),
  };
}

function mostLikely(
  probabilities: Readonly<Record<string, number>>,
): string | null {
  let best: string | null = null;
  let bestProbability = Number.NEGATIVE_INFINITY;
  for (const [name, probability] of Object.entries(probabilities)) {
    if (probability <= bestProbability) continue;
    best = name;
    bestProbability = probability;
  }
  return best;
}
