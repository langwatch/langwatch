import type { Plan } from "./plan.ts";

/**
 * Creation caps for scenarios, simulations (distinct scenario sets) and custom
 * evaluators. Only the cloud Free plan sets them; every paid cloud plan and
 * every self-hosted plan leaves them unset, which means uncapped.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export const creationLimitTypes = ["scenarios", "scenarioSets", "evaluators"] as const;

export type CreationLimitType = (typeof creationLimitTypes)[number];

/** What a plan says about creating one more: nothing to count, or a cap to count against. */
export type PlanCreationCap = { capped: false } | { capped: true; max: number };

export function planCreationCap({
  plan,
  limitType,
}: {
  plan: Pick<
    Plan,
    "maxScenarios" | "maxScenarioSets" | "maxEvaluators" | "overrideAddingLimitations"
  >;
  limitType: CreationLimitType;
}): PlanCreationCap {
  if (plan.overrideAddingLimitations) return { capped: false };
  const max = {
    scenarios: plan.maxScenarios,
    scenarioSets: plan.maxScenarioSets,
    evaluators: plan.maxEvaluators,
  }[limitType];
  return max === undefined ? { capped: false } : { capped: true, max };
}
