import type { USAGE_WARNING_THRESHOLDS } from "./usage-warning-thresholds";

/**
 * Type representing valid usage threshold values
 */
export type UsageThreshold = (typeof USAGE_WARNING_THRESHOLDS)[number];

