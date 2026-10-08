/**
 * The built-in models a picker hands its member: Instant Evals answers only an LLM judge,
 * so only a judge's picker offers it, and only once released (ADR-174 decision 11).
 * Otherwise it is labelled but not offered, so a saved model still reads by its name.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { isLlmJudgeEvaluator } from "@langwatch/evaluator-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import type { BuiltInModel } from "@langwatch/model-provider-contract";

/** How the picker names Instant Evals. */
export const INSTANT_EVALS_BUILT_IN_MODEL: BuiltInModel = {
  value: INSTANT_EVAL_JUDGE_MODEL_ID,
  label: "Instant Evals",
};

const OFFERED: readonly BuiltInModel[] = [INSTANT_EVALS_BUILT_IN_MODEL];
const LABELLED_ONLY: readonly BuiltInModel[] = [
  { ...INSTANT_EVALS_BUILT_IN_MODEL, isOffered: false },
];

/** Whether a picker on `evaluatorType` is a judge's, the only one Instant Evals answers. */
export function isInstantEvalJudgeSlot({
  evaluatorType,
}: {
  evaluatorType: string | undefined;
}): boolean {
  return !!evaluatorType && isLlmJudgeEvaluator(evaluatorType);
}

export function instantEvalJudgeModelsOf({
  evaluatorType,
  released,
}: {
  evaluatorType: string | undefined;
  released: boolean;
}): { builtInModels: readonly BuiltInModel[]; offered: boolean } {
  const offered = released && isInstantEvalJudgeSlot({ evaluatorType });
  return { builtInModels: offered ? OFFERED : LABELLED_ONLY, offered };
}
