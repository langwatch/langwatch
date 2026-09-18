import type { LimitType } from "@langwatch/enterprise-licensing-contract";

/**
 * Display labels for each limit type (title case, for table headers/labels).
 */
export const LIMIT_TYPE_DISPLAY_LABELS: Record<LimitType, string> = {
  members: "Team Members",
  membersLite: "Lite Members",
} as const;
