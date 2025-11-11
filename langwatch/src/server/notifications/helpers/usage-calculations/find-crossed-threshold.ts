import { USAGE_WARNING_THRESHOLDS } from "./usage-warning-thresholds";
import type { UsageThreshold } from "./usage-threshold.type";

/**
 * Find the highest threshold that has been crossed
 */
export function findCrossedThreshold(
  usagePercentage: number,
): UsageThreshold | null {
  const crossedThresholds = USAGE_WARNING_THRESHOLDS.filter(
    (threshold) => usagePercentage >= threshold,
  );
  return crossedThresholds.length > 0
    ? crossedThresholds[crossedThresholds.length - 1]!
    : null;
}

