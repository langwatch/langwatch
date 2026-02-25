import { isGrowthSeatEventPlan } from "../../../ee/billing/utils/growthSeatEvent";

export type ComparisonPlanId = "free" | "growth" | "enterprise";

type ActivePlanLike = {
  type?: string | null;
  free?: boolean | null;
};

export function resolveCurrentComparisonPlan(
  activePlan?: ActivePlanLike,
): ComparisonPlanId | null {
  if (!activePlan) {
    return null;
  }

  const normalizedType = activePlan.type?.toUpperCase();

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
