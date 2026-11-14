/**
 * Settings that only steer Instant Evals: the score judge's min and max set the scale Instant
 * Evals answers on, so they show only while the judge's model is a decision model, whichever
 * one the judge runs on.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { isDecisionModelId } from "@langwatch/model-provider-contract";

const INSTANT_EVAL_ONLY_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  "langevals/llm_score": ["min", "max"],
};

export function isSettingShownForModel({
  evaluatorType,
  settingKey,
  model,
}: {
  evaluatorType: string;
  settingKey: string;
  model: unknown;
}): boolean {
  const instantEvalOnly = INSTANT_EVAL_ONLY_SETTINGS[evaluatorType]?.includes(settingKey) ?? false;
  return !instantEvalOnly || (typeof model === "string" && isDecisionModelId(model));
}
