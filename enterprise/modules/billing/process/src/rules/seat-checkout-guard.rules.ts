import { isTieredPlan, PlanTypes } from "@langwatch/enterprise-billing-contract";

/**
 * Whether a live plan stops a new seat checkout. A paid checkout supersedes a linked tiered plan
 * and lands on an unlinked row (an operator's); any other linked plan is changed in place.
 */
export function blocksSeatCheckout(
  active: readonly { plan: string; stripeSubscriptionId: string | null }[],
): boolean {
  return active.some((row) => row.stripeSubscriptionId !== null && !isTieredPlan(row.plan));
}

/** The limits only an operator sets; any of them on a row makes it a custom deal. */
export const CUSTOM_LIMIT_COLUMNS = [
  "maxProjects",
  "maxWorkflows",
  "maxTeams",
  "maxPrompts",
  "maxEvaluators",
  "maxScenarios",
  "maxAgents",
  "maxExperiments",
  "maxOnlineEvaluations",
  "maxDatasets",
  "maxDashboards",
  "maxCustomGraphs",
  "maxAutomations",
] as const;

/** Whether any operator-only limit is set on the row. */
export function hasCustomLimits(
  row: Record<(typeof CUSTOM_LIMIT_COLUMNS)[number], number | null>,
): boolean {
  return CUSTOM_LIMIT_COLUMNS.some((column) => row[column] !== null);
}

/**
 * A plan set up by hand: ENTERPRISE, or any row an operator gave limits beyond seats. Billing never
 * checks one out, adopts it or closes it on its own; its seats change through support.
 */
export function isCustomDeal(row: { plan?: string; customLimits?: boolean }): boolean {
  return row.customLimits === true || row.plan === PlanTypes.ENTERPRISE;
}
