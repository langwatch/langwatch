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
  workflows: "workflows",
  prompts: "prompts",
  evaluators: "evaluators",
  scenarios: "scenarios",
  projects: "projects",
  teams: "teams",
  members: "team members",
  membersLite: "lite members",
  agents: "agents",
  experiments: "experiments",
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
  workflows: "Workflows",
  prompts: "Prompts",
  evaluators: "Evaluators",
  scenarios: "Scenarios",
  projects: "Projects",
  teams: "Teams",
  members: "Team Members",
  membersLite: "Lite Members",
  agents: "Agents",
  experiments: "Experiments",
} as const;
