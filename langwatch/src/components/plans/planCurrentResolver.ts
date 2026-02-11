export type ComparisonPlanId = "free" | "growth" | "enterprise";

type ActivePlanLike = {
  type?: string | null;
  free?: boolean | null;
};

const GROWTH_PLAN_TYPES = new Set(["GROWTH", "GROWTH_SEAT_USAGE"]);

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

  if (normalizedType && GROWTH_PLAN_TYPES.has(normalizedType)) {
    return "growth";
  }

  if (normalizedType === "ENTERPRISE") {
    return "enterprise";
  }

  return null;
}
