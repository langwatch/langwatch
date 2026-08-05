import { isGrowthSeatEventPlan } from "../../../ee/billing/utils/growthSeatEvent";

export type ComparisonPlanId = "free" | "growth" | "enterprise";

type ActivePlanLike = {
  type?: string | null;
  free?: boolean | null;
};

/**
 * The plan a self-hosted deployment runs on without a license. It is flagged
 * `free`, but it is not the Cloud Free tier and is not capped like one: seats,
 * teams, projects and its own trace history are all uncapped there. Marking
 * that tier as current would show an operator the two-seat, fifty-thousand-event
 * numbers of a tier they are not on and are not limited by.
 */
const OPEN_SOURCE_PLAN_TYPE = "OPEN_SOURCE";

export function resolveCurrentComparisonPlan(
  activePlan?: ActivePlanLike,
): ComparisonPlanId | null {
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

  if (
    normalizedType === "GROWTH" ||
    (normalizedType && isGrowthSeatEventPlan(normalizedType))
  ) {
    return "growth";
  }

  if (normalizedType === "ENTERPRISE") {
    return "enterprise";
  }

  return null;
}
