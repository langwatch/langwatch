/**
 * Questions on the wire and the answers read back: `boolean` is `noul`,
 * `score` is `score`, `category` is `choice`, matched by id never position.
 * @see modules/instant-eval/specs/classifier.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

import type {
  InstantEvalCategoryQuestion,
  InstantEvalQuestion,
  InstantEvalScoreQuestion,
  InstantEvalVerdict,
} from "./instant-eval-judge.api.ts";

/** The levels a score question offers, low to high: its named levels' indexes when it has them. */
function instantEvalScoreLevels(question: InstantEvalScoreQuestion): number[] {
  if (question.levels) return question.levels.map((_, index) => index);
  const { min, max } = question.range;
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/** One question as the judge takes it. */
type ClassifierWireQuestion = Readonly<Record<string, unknown>>;

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
  assertLevelsMatchRange(question);
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
      criteria: question.levels ?? instantEvalScoreLevels(question).map(String),
    };
  }
  return {
    type: "choice",
    instructions: question.instructions,
    criteria: categoryCriteria(question),
  };
}

/**
 * Named levels are read back as 0-based indexes, so a range other than 0 to the last index
 * would report a score outside it. Refused before any call rather than read wrong.
 */
function assertLevelsMatchRange(question: InstantEvalQuestion): void {
  if (question.kind !== "score" || !question.levels) return;
  const { min, max } = question.range;
  if (min !== 0 || max !== question.levels.length - 1) {
    throw new Error(
      `Score question "${question.id}" names ${question.levels.length} levels, so its range must be 0 to ${question.levels.length - 1}, not ${min} to ${max}`,
    );
  }
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

const classifierResponseSchemaDefinition = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});
export interface ClassifierResponseSchema extends Named<
  typeof classifierResponseSchemaDefinition
> {}
export const classifierResponseSchema: ClassifierResponseSchema =
  classifierResponseSchemaDefinition;

type ClassifierResponse = z.infer<typeof classifierResponseSchema>;
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
      ...score,
    }));
  }
  return findCategoryVerdict({ question, answer });
}

/**
 * The probability-weighted mean of a score question's levels: a distribution
 * split evenly between 2 and 4 means 3, a better answer than either endpoint.
 * With it the levels' weighted standard deviation: how sure that mean is.
 */
function findWeightedScore({
  question,
  answer,
}: {
  question: InstantEvalScoreQuestion;
  answer: ClassifierAnswer;
}): { score: number; spread?: number }[] {
  const levels = instantEvalScoreLevels(question);
  const { probabilities } = answer;
  if (probabilities) {
    const keyed = {
      levels,
      ...(answer.legend ? { legend: answer.legend } : {}),
      ...(question.levels ? { names: question.levels } : {}),
    };
    const weighted: { level: number; probability: number }[] = [];
    for (const [key, probability] of Object.entries(probabilities)) {
      const [level] = findLevelForKey({ key, ...keyed });
      if (level !== undefined) weighted.push({ level, probability });
    }
    const weight = weighted.reduce((sum, { probability }) => sum + probability, 0);
    if (weight > 0) {
      const mean = weighted.reduce((sum, w) => sum + w.level * w.probability, 0) / weight;
      const variance =
        weighted.reduce((sum, w) => sum + w.probability * (w.level - mean) ** 2, 0) / weight;
      return [{ score: mean, spread: Math.sqrt(variance) }];
    }
  }
  // A bare score is a level position; named levels start at 0, so the offset holds for them too.
  return typeof answer.score === "number" ? [{ score: question.range.min + answer.score }] : [];
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
  names,
}: {
  key: string;
  levels: readonly number[];
  legend?: Readonly<Record<string, string>>;
  /** The question's named levels, when it sent names in place of numbers. */
  names?: readonly string[];
}): number[] {
  const named = legend?.[key];
  if (named !== undefined) {
    const [value] = names ? findNamedLevelIndex({ said: named, names }) : [Number(named)];
    const fromLegend = findOfferedLevel({ value, levels });
    if (fromLegend.length > 0) return fromLegend;
  }
  // Named levels take digit keys only as positions: `Number("")` is 0, the lowest level's index.
  const isPosition = names ? /^\d+$/.test(key) : Number.isInteger(Number(key));
  if (isPosition) {
    const fromPosition = findOfferedLevel({ value: levels[Number(key)], levels });
    if (fromPosition.length > 0) return fromPosition;
  }
  const [value] = names ? findNamedLevelIndex({ said: key, names }) : [Number(key)];
  return findOfferedLevel({ value, levels });
}

/**
 * The index of the named level a key or legend entry stands for: the level as sent, or its label,
 * the part before the first colon ("hard: needs multi-step checking" answers to "hard"), both
 * compared ignoring case and surrounding space (" Hard" answers to "hard").
 */
function findNamedLevelIndex({
  said,
  names,
}: {
  said: string;
  names: readonly string[];
}): number[] {
  const loose = (text: string) => text.trim().toLowerCase();
  const heard = loose(said);
  const exact = names.findIndex((name) => loose(name) === heard);
  if (exact >= 0) return [exact];
  // A label stands for a level only when it names one: "risk" fits "risk: low" and "risk: high".
  const byLabel = names.flatMap((name, at) => {
    const label = loose(name.split(":", 1)[0] ?? name);
    return heard === label || heard.startsWith(`${label}:`) ? [at] : [];
  });
  return byLabel.length === 1 ? byLabel : [];
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
