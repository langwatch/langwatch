/**
 * Which models a run really used.
 *
 * A run plan can name the model that plays the person and the model that
 * decides the verdict. When it names neither, the project default answers, and
 * that default changes over time. A run that recorded only "the plan named no
 * model" therefore cannot tell a reader, a month later, which model judged it.
 *
 * So a run records BOTH: the models the plan was configured with, which is
 * what keys a configuration, and the models the run resolved, which is what a
 * person reads back off the run. The chain that picks them is written once
 * here and used by the queue path and by the execution prefetch, so the value
 * stamped on the run is the value the run ran on.
 *
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 * @see specs/scenarios/run-configuration-on-runs.feature
 */

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

/**
 * The model each simulation role runs on: the run plan's choice, else the
 * case's own choice, else the project default for that role.
 *
 * @param plan - What the run plan names, empty when it names nothing.
 * @param scenario - What the case names, empty when it names nothing.
 * @param resolveFeatureModel - Reads the project default for a feature key.
 *   It throws when the project has no model set for that key, and the caller
 *   decides what that means: the prefetch refuses the run, the queue path
 *   records no resolved model and lets the prefetch report the fault.
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
  const simulatorModel =
    plan.simulatorModel ??
    scenario.simulatorModel ??
    (await resolveFeatureModel(SIMULATOR_MODEL_FEATURE_KEY));
  const judgeModel =
    plan.judgeModel ??
    scenario.judgeModel ??
    (await resolveFeatureModel(JUDGE_MODEL_FEATURE_KEY));
  return { simulatorModel, judgeModel };
}

/**
 * The resolved-model entries of the reserved `langwatch` namespace, or nothing
 * at all.
 *
 * A run whose models could not be resolved records none of these. It reads
 * back the way every run recorded before this field existed reads back, so one
 * fallback in the UI covers both.
 */
export function withResolvedModels(
  models: Partial<ResolvedRunModels> | undefined | null,
):
  | { resolvedSimulatorModel?: string; resolvedJudgeModel?: string }
  | Record<string, never> {
  return {
    ...(models?.simulatorModel
      ? { resolvedSimulatorModel: models.simulatorModel }
      : {}),
    ...(models?.judgeModel ? { resolvedJudgeModel: models.judgeModel } : {}),
  };
}
