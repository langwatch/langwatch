import type { LimitType } from "@langwatch/enterprise-licensing-contract";

/**
 * Human-readable labels for each limit type (single source of truth).
 * Used by UpgradeModal and errors for limit-reached messages.
 */
export const LIMIT_TYPE_LABELS: Record<LimitType, string> = {
  members: "team members",
  membersLite: "lite members",
} as const;

/** Title-case labels for each limit type, for headers and usage rows. */
export const LIMIT_TYPE_DISPLAY_LABELS: Record<LimitType, string> = {
  members: "Team Members",
  membersLite: "Lite Members",
} as const;

/**
 * The Developer seat (ADR-171) is not a `LimitType`: it is counted beside the
 * metered seats and never compared to a limit, so it has a label and no limit.
 */
export const DEVELOPER_SEAT_DISPLAY_LABEL = "Developers";
