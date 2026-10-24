/**
 * A Scenario run's criteria as the router takes them: one yes-or-no question per criterion in
 * the measured wording, over the scenario and the conversation, and met / not met read back.
 * The scenario-side wiring that sends these is not built yet.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { InstantEvalBooleanQuestion, InstantEvalJudgement } from "./instant-eval-judge.api.ts";

/** What counts as met, then what counts as not met: missing evidence is not met. */
export const INSTANT_EVAL_CRITERION_TRUE = "The conversation shows the criterion was met.";
export const INSTANT_EVAL_CRITERION_FALSE =
  "The conversation does not show the criterion was met: it was violated, or the evidence for it is missing.";

/** The instructions are cut here, as the measured harness cut them. */
const CRITERION_INSTRUCTIONS_MAX_CHARS = 4_000;

/** One criterion as a yes-or-no question; its id is how the verdict is read back. */
export function instantEvalCriterionQuestionOf({
  id,
  criterion,
}: {
  id: string;
  criterion: string;
}): InstantEvalBooleanQuestion {
  const instructions = [
    "Judge the AI agent under test (the assistant) in this simulated conversation against one",
    "success criterion, independently of any other goal. Criterion:",
    criterion,
  ]
    .join(" ")
    .slice(0, CRITERION_INSTRUCTIONS_MAX_CHARS);
  return {
    id,
    kind: "boolean",
    instructions,
    criteria: [INSTANT_EVAL_CRITERION_TRUE, INSTANT_EVAL_CRITERION_FALSE],
  };
}

/** The judged text: the scenario's description, then the conversation as rendered. */
export function instantEvalScenarioJudgeTextOf({
  description,
  conversation,
}: {
  description: string;
  conversation: string;
}): string {
  return `# Scenario\n${description}\n\n# Conversation\n${conversation}`;
}

/** A criterion's verdict: met at P(met) of one half or more; null when it went unanswered. */
export interface InstantEvalCriterionVerdict {
  readonly id: string;
  readonly met: boolean | null;
  readonly probability: number | null;
}

/** Per criterion question, in order; a skip or a missing answer is null, never "not met". */
export function instantEvalCriterionVerdictsOf({
  questions,
  judgement,
}: {
  questions: readonly InstantEvalBooleanQuestion[];
  judgement: InstantEvalJudgement;
}): InstantEvalCriterionVerdict[] {
  return questions.map(({ id }) => {
    const probability = judgement.verdicts.find(
      (verdict) => verdict.questionId === id,
    )?.probability;
    if (probability === undefined) return { id, met: null, probability: null };
    return { id, met: probability >= 0.5, probability };
  });
}
