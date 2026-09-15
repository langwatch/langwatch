import type { LimitType } from "@langwatch/enterprise-licensing-contract";

/**
 * Display labels for each limit type (title case, for use as table headers/labels).
 *
 * @example
 * `<Label>{LIMIT_TYPE_DISPLAY_LABELS[limitType]}:</Label>`
 * // "Team Members:"
 */
export const LIMIT_TYPE_DISPLAY_LABELS: Record<LimitType, string> = {
  members: "Team Members",
  membersLite: "Lite Members",
} as const;
