/**
 * Settings that only steer Instant Evals: the score judge's min and max set the
 * scale Instant Evals answers on, so they show only while it is the judge's model.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";

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
  return !instantEvalOnly || model === INSTANT_EVAL_JUDGE_MODEL_ID;
}
