/** Which models a run really used; runs record both plan config and resolved
 * models so readers can see which model judged them months later.
 */

import { expandLatestAlias } from "@langwatch/model-provider-contract";

/** The project-default feature key each simulation role resolves against. */
export const SIMULATOR_MODEL_FEATURE_KEY = "scenarios.user_simulator";
export const JUDGE_MODEL_FEATURE_KEY = "scenarios.judge";

/** A simulator and judge model choice, at one level of the chain. */
export type RunModelChoice = {
  simulatorModel?: string | null;
  judgeModel?: string | null;
};

/** The models one run runs on, both named. */
export type ResolvedRunModels = {
  simulatorModel: string;
  judgeModel: string;
};

/** Resolves models for each simulation role: plan choice > scenario > project
 * default, passing aliases through expandLatestAlias.
 */
export async function resolveRunModels({
  plan,
  scenario,
  resolveFeatureModel,
}: {
  plan: RunModelChoice;
  scenario: RunModelChoice;
  resolveFeatureModel: (featureKey: string) => Promise<string>;
}): Promise<ResolvedRunModels> {
  const simulatorModel = expandLatestAlias(
    plan.simulatorModel ??
      scenario.simulatorModel ??
      (await resolveFeatureModel(SIMULATOR_MODEL_FEATURE_KEY)),
  );
  const judgeModel = expandLatestAlias(
    plan.judgeModel ?? scenario.judgeModel ?? (await resolveFeatureModel(JUDGE_MODEL_FEATURE_KEY)),
  );
  return { simulatorModel, judgeModel };
}

/**
 * The resolved-model entries of the reserved `langwatch` namespace, or
 * nothing at all. An unresolved run records none, reading back the same
 * way a run from before this field existed does, so one UI fallback covers both.
 */
export function withResolvedModels(
  models: Partial<ResolvedRunModels> | undefined | null,
): { resolvedSimulatorModel?: string; resolvedJudgeModel?: string } | Record<string, never> {
  return {
    ...(models?.simulatorModel ? { resolvedSimulatorModel: models.simulatorModel } : {}),
    ...(models?.judgeModel ? { resolvedJudgeModel: models.judgeModel } : {}),
  };
}
