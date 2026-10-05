import type { LimitType } from "./types";

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

/**
 * Display labels for each limit type (title case, for use as table headers/labels).
 *
 * Used by:
 * - ResourceLimitsDisplay.tsx - for displaying resource limits
 *
 * @example
 * `<Label>{LIMIT_TYPE_DISPLAY_LABELS[limitType]}:</Label>`
 * // "Team Members:"
 */
export const LIMIT_TYPE_DISPLAY_LABELS: Record<LimitType, string> = {
  members: "Team Members",
  membersLite: "Lite Members",
} as const;

/**
 * The Developer seat (ADR-143) is not a `LimitType`: it is counted on the
 * plan page beside the metered seats and never compared to a limit, so it
 * has a display label and no entry in the limit maps above.
 */
export const DEVELOPER_SEAT_DISPLAY_LABEL = "Developers";
