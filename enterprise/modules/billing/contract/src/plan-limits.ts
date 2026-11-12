import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import {
  planCatalogue,
  quotedLimitsOfPlan,
  UNLIMITED_MESSAGES as NO_MESSAGE_CAP,
} from "@langwatch/plans";

import { type PlanTypes as PlanType, PlanTypes } from "./plan-types.ts";

/**
 * Sentinel value representing no message cap.
 * When a limit is set to this value, it means there is no limit.
 */
export const UNLIMITED_MESSAGES = NO_MESSAGE_CAP;

/**
 * One catalogue plan, in the field names a resolved plan is quoted under.
 * Nothing is decided here: every number, name and price is the catalogue's,
 * and a plan a person sells is still billed as a subscription.
 */
function presetOf(type: PlanType): PlanInfo {
  const plan = planCatalogue.plan(type);

  return {
    planSource: plan.free ? "free" : "subscription",
    type: plan.type,
    name: plan.name,
    free: plan.free,
    ...quotedLimitsOfPlan(plan),
  };
}

/**
 * Caps on the cloud Free plan. Paid plans leave them unset, which means
 * uncapped. Creation caps refuse only one more; scenario runs are capped per
 * UTC month once the grace after the first run is over.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export const FREE_PLAN_CREATION_CAPS = {
  maxScenarios: 3,
  maxEvaluators: 3,
  maxScenarioRunsPerMonth: 100,
  scenarioRunGraceDays: 14,
} as const satisfies Pick<
  PlanInfo,
  "maxScenarios" | "maxEvaluators" | "maxScenarioRunsPerMonth" | "scenarioRunGraceDays"
>;

export const PLAN_LIMITS: Record<PlanType, PlanInfo> = {
  // Cloud Free only. Self-hosted resolves its plan from the license
  // provider and never reads this table, so it stays uncapped.
  [PlanTypes.FREE]: { ...presetOf(PlanTypes.FREE), ...FREE_PLAN_CREATION_CAPS },
  [PlanTypes.PRO]: presetOf(PlanTypes.PRO),
  [PlanTypes.LAUNCH]: presetOf(PlanTypes.LAUNCH),
  [PlanTypes.LAUNCH_ANNUAL]: presetOf(PlanTypes.LAUNCH_ANNUAL),
  [PlanTypes.ACCELERATE]: presetOf(PlanTypes.ACCELERATE),
  [PlanTypes.ACCELERATE_ANNUAL]: presetOf(PlanTypes.ACCELERATE_ANNUAL),
  [PlanTypes.GROWTH]: presetOf(PlanTypes.GROWTH),
  [PlanTypes.GROWTH_SEAT_EUR_MONTHLY]: presetOf(PlanTypes.GROWTH_SEAT_EUR_MONTHLY),
  [PlanTypes.GROWTH_SEAT_EUR_ANNUAL]: presetOf(PlanTypes.GROWTH_SEAT_EUR_ANNUAL),
  [PlanTypes.GROWTH_SEAT_USD_MONTHLY]: presetOf(PlanTypes.GROWTH_SEAT_USD_MONTHLY),
  [PlanTypes.GROWTH_SEAT_USD_ANNUAL]: presetOf(PlanTypes.GROWTH_SEAT_USD_ANNUAL),
  [PlanTypes.ENTERPRISE]: presetOf(PlanTypes.ENTERPRISE),
};

/**
 * The FREE plan limits for any organization. Every free-tier organization gets
 * the same monthly volume regardless of pricing model.
 */
export const getFreePlanLimits = (): PlanInfo => PLAN_LIMITS[PlanTypes.FREE];
