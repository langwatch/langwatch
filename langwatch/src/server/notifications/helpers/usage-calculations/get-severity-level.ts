import type { UsageThreshold } from "./usage-threshold.type";

/**
 * Get severity level for email styling based on threshold
 */
export function getSeverityLevel(threshold: UsageThreshold): string {
  if (threshold >= 95) return "critical";
  if (threshold >= 90) return "high";
  if (threshold >= 70) return "medium";
  return "low";
}

