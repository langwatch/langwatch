import type { Plan } from "./plan.ts";

/**
 * Creation caps for scenarios and custom evaluators, and the monthly scenario
 * run cap. Only the cloud Free plan sets them; every paid cloud plan and every
 * self-hosted plan leaves them unset, which means uncapped.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export const creationLimitTypes = ["scenarios", "evaluators"] as const;

export type CreationLimitType = (typeof creationLimitTypes)[number];

/** The limit type a refused scenario run names. */
export const SCENARIO_RUNS_LIMIT_TYPE = "scenarioRuns" as const;

/** What a plan says about creating one more: nothing to count, or a cap to count against. */
export type PlanCreationCap = { capped: false } | { capped: true; max: number };

export function planCreationCap({
  plan,
  limitType,
}: {
  plan: Pick<Plan, "maxScenarios" | "maxEvaluators" | "overrideAddingLimitations">;
  limitType: CreationLimitType;
}): PlanCreationCap {
  if (plan.overrideAddingLimitations) return { capped: false };
  const max = { scenarios: plan.maxScenarios, evaluators: plan.maxEvaluators }[limitType];
  return max === undefined ? { capped: false } : { capped: true, max };
}

/** What a plan says about scenario runs: unlimited, or a monthly cap after a grace in days. */
export type PlanScenarioRunCap =
  | { capped: false }
  | { capped: true; maxPerMonth: number; graceDays: number };

export function planScenarioRunCap({
  plan,
}: {
  plan: Pick<
    Plan,
    "maxScenarioRunsPerMonth" | "scenarioRunGraceDays" | "overrideAddingLimitations"
  >;
}): PlanScenarioRunCap {
  if (plan.overrideAddingLimitations) return { capped: false };
  if (plan.maxScenarioRunsPerMonth === undefined) return { capped: false };
  return {
    capped: true,
    maxPerMonth: plan.maxScenarioRunsPerMonth,
    graceDays: plan.scenarioRunGraceDays ?? 0,
  };
}
