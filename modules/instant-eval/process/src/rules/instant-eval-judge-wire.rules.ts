/**
 * Questions on the wire and the answers read back: `boolean` is `noul`,
 * `score` is `score`, `category` is `choice`, matched by id never position.
 * @see specs/instant-evals/classifier.feature
 */

import type {
  InstantEvalCategoryQuestion,
  InstantEvalQuestion,
  InstantEvalScoreQuestion,
  InstantEvalVerdict,
} from "@langwatch/instant-eval-contract";
import { z } from "zod";

/** The levels a score question offers, low to high. */
export function instantEvalScoreLevels(question: InstantEvalScoreQuestion): number[] {
  const { min, max } = question.range;
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/** One question as the judge takes it. */
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

function toClassifierQuestion(question: InstantEvalQuestion): ClassifierWireQuestion {
  if (question.kind === "boolean") {
    const { criteria } = question;
    return {
      type: "noul",
      instructions: question.instructions,
      // The judge names the two sides `true` and `false`, so the pair is
      // spread onto those keys rather than sent as a list it would refuse.
      ...(criteria ? { criteria: { true: criteria[0], false: criteria[1] } } : {}),
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

function categoryCriteria(question: InstantEvalCategoryQuestion): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const option of question.options) criteria[option.name] = option.description;
  return criteria;
}

const answerSchema = z.object({
  type: z.string().optional(),
  noul: z.number().optional(),
  choice: z.string().optional(),
  score: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  /**
   * For a score answer, which level each probability key stands for: the keys
   * are level positions and `legend` maps each position to the criterion sent.
   * Reading the legend keeps this correct if the keys become the criteria.
   */
  legend: z.record(z.string(), z.string()).optional(),
  confidence: z.number().optional(),
});

export const classifierResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

export type ClassifierResponse = z.infer<typeof classifierResponseSchema>;
type ClassifierAnswer = z.infer<typeof answerSchema>;

/**
 * One verdict per question, read from the answer that question's id names. A
 * question with no answer is dropped rather than defaulted.
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
    verdicts.push(...findVerdict({ question, answer }));
  }
  return verdicts;
}

/** The verdict this answer carries, or none when it carries nothing readable. */
function findVerdict({
  question,
  answer,
}: {
  question: InstantEvalQuestion;
  answer: ClassifierAnswer;
}): InstantEvalVerdict[] {
  if (question.kind === "boolean") {
    return typeof answer.noul === "number"
      ? [{ questionId: question.id, probability: answer.noul }]
      : [];
  }
  if (question.kind === "score") {
    return findWeightedScore({ question, answer }).map((score) => ({
      questionId: question.id,
      score,
    }));
  }
  return findCategoryVerdict({ question, answer });
}

/**
 * The probability-weighted mean of a score question's levels: a distribution
 * split evenly between 2 and 4 means 3, and either endpoint would be a worse
 * answer than the one we can compute.
 */
function findWeightedScore({
  question,
  answer,
}: {
  question: InstantEvalScoreQuestion;
  answer: ClassifierAnswer;
}): number[] {
  const levels = instantEvalScoreLevels(question);
  const { probabilities } = answer;
  if (probabilities) {
    let total = 0;
    let weight = 0;
    for (const [key, probability] of Object.entries(probabilities)) {
      const [level] = findLevelForKey({
        key,
        levels,
        ...(answer.legend ? { legend: answer.legend } : {}),
      });
      if (level === undefined) continue;
      total += level * probability;
      weight += probability;
    }
    if (weight > 0) return [total / weight];
  }
  return typeof answer.score === "number" ? [question.range.min + answer.score] : [];
}

/**
 * The level one probability key stands for, or none when it names one this
 * question never offered — so a legend entry that was never sent cannot pull
 * the mean towards a value the caller did not ask about.
 */
function findLevelForKey({
  key,
  levels,
  legend,
}: {
  key: string;
  levels: readonly number[];
  legend?: Readonly<Record<string, string>>;
}): number[] {
  const named = legend?.[key];
  if (named !== undefined) {
    const fromLegend = findOfferedLevel({ value: Number(named), levels });
    if (fromLegend.length > 0) return fromLegend;
  }
  const position = Number(key);
  if (Number.isInteger(position)) {
    const fromPosition = findOfferedLevel({ value: levels[position], levels });
    if (fromPosition.length > 0) return fromPosition;
  }
  return findOfferedLevel({ value: Number(key), levels });
}

function findOfferedLevel({
  value,
  levels,
}: {
  value: number | undefined;
  levels: readonly number[];
}): number[] {
  return value !== undefined && levels.includes(value) ? [value] : [];
}

function findCategoryVerdict({
  question,
  answer,
}: {
  question: InstantEvalCategoryQuestion;
  answer: ClassifierAnswer;
}): InstantEvalVerdict[] {
  const names = new Set(question.options.map((option) => option.name));
  const probabilities = Object.fromEntries(
    Object.entries(answer.probabilities ?? {}).filter(([name]) => names.has(name)),
  );
  const [label] =
    answer.choice && names.has(answer.choice) ? [answer.choice] : findMostLikely(probabilities);
  if (label === undefined) return [];
  return [
    {
      questionId: question.id,
      label,
      ...(Object.keys(probabilities).length > 0 ? { probabilities } : {}),
    },
  ];
}

/** The likeliest option, or none when the distribution is empty. */
function findMostLikely(probabilities: Readonly<Record<string, number>>): string[] {
  let best: string[] = [];
  let bestProbability = Number.NEGATIVE_INFINITY;
  for (const [name, probability] of Object.entries(probabilities)) {
    if (probability <= bestProbability) continue;
    best = [name];
    bestProbability = probability;
  }
  return best;
}
