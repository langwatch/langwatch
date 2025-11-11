/**
 * Pure functions for usage limit calculations
 * Single Responsibility: Calculate usage metrics
 */

export const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const;

export type UsageThreshold = (typeof USAGE_WARNING_THRESHOLDS)[number];

/**
 * Calculate usage as a percentage of the limit
 */
export function calculateUsagePercentage({
  currentUsage,
  limit,
}: {
  currentUsage: number;
  limit: number;
}): number {
  return limit > 0 ? (currentUsage / limit) * 100 : 0;
}

/**
 * Find the highest threshold that has been crossed
 * Returns undefined if no threshold has been crossed
 */
export function findCrossedThreshold(
  usagePercentage: number,
): UsageThreshold | undefined {
  return USAGE_WARNING_THRESHOLDS.findLast(
    (threshold) => usagePercentage >= threshold,
  );
}

/**
 * Determine severity level based on threshold
 */
export function getSeverityLevel(
  threshold: UsageThreshold,
): "Critical" | "High" | "Medium" | "Info" {
  if (threshold >= 95) {
    return "Critical";
  }
  if (threshold >= 90) {
    return "High";
  }
  if (threshold >= 70) {
    return "Medium";
  }
  return "Info";
}

