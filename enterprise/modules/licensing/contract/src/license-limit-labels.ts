import type { LimitType } from "@langwatch/enterprise-licensing-contract";

/**
 * Human-readable labels for each limit type (single source of truth).
 * Used by UpgradeModal and errors for limit-reached messages.
 */
export const LIMIT_TYPE_LABELS: Record<LimitType, string> = {
  members: "team members",
  membersLite: "lite members",
} as const;
