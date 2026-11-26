/**
 * A scenario judgement's pure steps: the text and the one question each criterion is routed with
 * (the wording the route was measured on), how a judge's own verdict call is read back by
 * criterion key, and what a criterion's routed verdict means.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import type {
  InstantEvalBooleanQuestion,
  InstantEvalScenarioCriterionResult,
  InstantEvalVerdict,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

/** A criterion longer than this is cut in its question; the whole call still carries it whole. */
const MAX_CRITERION_CHARACTERS = 4_000;

const CRITERION_SIDES = [
  "The conversation shows the criterion was met.",
  "The conversation does not show the criterion was met: it was violated, or the evidence for it is missing.",
] as const;

/** The judged text, the same for every criterion, so every criterion takes the same bucket. */
export function instantEvalScenarioTextOf({
  description,
  content,
}: {
  description: string;
  content: string;
}): string {
  return `# Scenario\n${description}\n\n${content}`;
}

/** One criterion as the yes or no question a decision model is asked; its id is its key. */
export function instantEvalScenarioQuestionOf({
  key,
  text,
}: {
  key: string;
  text: string;
}): InstantEvalBooleanQuestion {
  const criterion = text.slice(0, MAX_CRITERION_CHARACTERS);
  return {
    id: key,
    kind: "boolean",
    instructions: `Judge the AI agent under test (the assistant) in this simulated conversation against one success criterion, independently of any other goal. Criterion: ${criterion}`,
    criteria: CRITERION_SIDES,
  };
}

const ANSWER_OF_STATUS = { passed: "true", failed: "false", inconclusive: "inconclusive" } as const;
const statusSchema = z.enum(["passed", "failed", "inconclusive"]);

/**
 * One criterion's entry: the scenario SDK's `{ requirement, reasoning, status }` object (1.8 and
 * later), or the bare status, `"true"`, `"false"`, `"inconclusive"` or a boolean older SDKs send.
 */
const criterionAnswerSchema = z.union([
  z
    .object({ status: statusSchema })
    .transform(({ status }): "true" | "false" | "inconclusive" => ANSWER_OF_STATUS[status]),
  statusSchema.transform((status): "true" | "false" | "inconclusive" => ANSWER_OF_STATUS[status]),
  z.enum(["true", "false", "inconclusive"]),
  z.boolean().transform((value) => (value ? ("true" as const) : ("false" as const))),
]);

const verdictCallSchema = z.object({
  criteria: z.record(z.string(), z.unknown()),
  reasoning: z.string().optional(),
});

/** What a judge's own verdict call said, per criterion key; an unreadable entry is left out. */
export type InstantEvalScenarioVerdictReading = Readonly<{
  criteria: ReadonlyMap<string, "true" | "false" | "inconclusive">;
  reasoning?: string;
}>;

export function findInstantEvalScenarioVerdictReading(
  input: unknown,
): InstantEvalScenarioVerdictReading | undefined {
  const parsed = verdictCallSchema.safeParse(input);
  if (!parsed.success) return void 0;
  const criteria = new Map<string, "true" | "false" | "inconclusive">();
  for (const [key, value] of Object.entries(parsed.data.criteria)) {
    const answer = criterionAnswerSchema.safeParse(value);
    if (answer.success) criteria.set(key, answer.data);
  }
  const { reasoning } = parsed.data;
  return { criteria, ...(reasoning ? { reasoning } : {}) };
}

/** A whole-call answer as the verdict a routed leg supplies: sure, or read and left unsettled. */
export function instantEvalScenarioLlmVerdictOf({
  questionId,
  answer,
}: {
  questionId: string;
  answer: "true" | "false" | "inconclusive";
}): InstantEvalVerdict {
  if (answer === "inconclusive") return { questionId, isInconclusive: true };
  return { questionId, probability: answer === "true" ? 1 : 0 };
}

/** Met at a probability of one half or more; no verdict at all is inconclusive, never a guess. */
export function instantEvalScenarioCriterionResultOf(
  verdict: InstantEvalVerdict | undefined,
): InstantEvalScenarioCriterionResult {
  if (!verdict || verdict.isInconclusive || verdict.probability === undefined) {
    return "inconclusive";
  }
  return verdict.probability >= 0.5 ? "met" : "unmet";
}
