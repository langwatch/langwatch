import { isGrowthSeatEventPlan } from "@langwatch/enterprise-billing-contract";

export type ComparisonPlanId = "free" | "growth" | "enterprise";

type ActivePlanLike = {
  type?: string | null;
  free?: boolean | null;
};

/**
 * The plan a self-hosted deployment runs on without a license. Flagged
 * `free`, but not the Cloud Free tier — seats, teams, projects and trace
 * history are all uncapped, unlike that tier's limited numbers.
 */
const OPEN_SOURCE_PLAN_TYPE = "OPEN_SOURCE";

export function resolveCurrentComparisonPlan(activePlan?: ActivePlanLike): ComparisonPlanId | null {
  if (!activePlan) {
    return null;
  }

  const normalizedType = activePlan.type?.toUpperCase();

  if (normalizedType === OPEN_SOURCE_PLAN_TYPE) {
    return null;
  }

  if (activePlan.free || normalizedType === "FREE") {
    return "free";
  }

  if (normalizedType === "GROWTH" || (normalizedType && isGrowthSeatEventPlan(normalizedType))) {
    return "growth";
  }

  if (normalizedType === "ENTERPRISE") {
    return "enterprise";
  }

  return null;
}
