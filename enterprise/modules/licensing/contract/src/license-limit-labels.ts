import type { LimitType } from "@langwatch/enterprise-licensing-contract";

/**
 * Human-readable labels for each limit type (lowercase, for use in sentences).
 * This is the single source of truth for limit type labels across the application.
 *
 * Used by:
 * - UpgradeModal.tsx - for displaying limit reached messages
 * - errors.ts - for user-friendly error messages
 *
 * @example
 * `You've reached the limit of ${LIMIT_TYPE_LABELS[limitType]}`
 * // "You've reached the limit of team members"
 */
export const LIMIT_TYPE_LABELS: Record<LimitType, string> = {
  members: "team members",
  membersLite: "lite members",
} as const;
