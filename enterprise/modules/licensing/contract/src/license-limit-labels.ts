/**
 * Human-readable labels for each limit type (single source of truth).
 * Used by UpgradeModal and errors for limit-reached messages.
 */
export const LIMIT_TYPE_LABELS: Record<LimitType, string> = {
  members: "team members",
  membersLite: "lite members",
  scenarios: "scenarios",
  scenarioSets: "simulations",
  evaluators: "custom evaluators",
} as const;

/** Title-case labels for each limit type, for headers and usage rows. */
export const LIMIT_TYPE_DISPLAY_LABELS: Record<LimitType, string> = {
  members: "Team Members",
  membersLite: "Lite Members",
  scenarios: "Scenarios",
  scenarioSets: "Simulations",
  evaluators: "Custom Evaluators",
} as const;

/**
 * The Developer seat (ADR-171) is not a `LimitType`: it is counted beside the
 * metered seats and never compared to a limit, so it has a label and no limit.
 */
export const DEVELOPER_SEAT_DISPLAY_LABEL = "Developers";

/**
 * The limits a refusal names, keyed by the labels and the refusal below: the
 * seats organization checks, and the cloud Free creation caps the owning
 * modules check (entitlement-contract `plan-creation-caps.ts`).
 */
export const limitTypes = [
  "members",
  "membersLite",
  "scenarios",
  "scenarioSets",
  "evaluators",
] as const;

export type LimitType = (typeof limitTypes)[number];

/**
 * The two kinds of seat a license meters. Which one a member holds is
 * server-decided (role, custom-role permissions); seat pricing, usage
 * display and limit enforcement all must name the same two values.
 */
export type MemberType = "FullMember" | "LiteMember" | "Developer";
