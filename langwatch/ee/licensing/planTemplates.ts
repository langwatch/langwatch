import type { LicensePlanLimits } from "./types";
import { DEFAULT_LIMIT } from "./constants";

/**
 * GROWTH plan template with unlimited limits except maxMembers.
 * maxMembers must be supplied at generation time (from Stripe seat quantity).
 * Used for self-serving license purchases.
 */
export const GROWTH_TEMPLATE: Omit<LicensePlanLimits, "maxMembers"> = {
  type: "GROWTH",
  name: "Growth",
  maxMembersLite: DEFAULT_LIMIT,
  maxTeams: DEFAULT_LIMIT,
  maxProjects: DEFAULT_LIMIT,
  maxMessagesPerMonth: DEFAULT_LIMIT,
  evaluationsCredit: DEFAULT_LIMIT,
  maxWorkflows: DEFAULT_LIMIT,
  maxPrompts: DEFAULT_LIMIT,
  maxEvaluators: DEFAULT_LIMIT,
  maxScenarios: DEFAULT_LIMIT,
  maxAgents: DEFAULT_LIMIT,
  maxExperiments: DEFAULT_LIMIT,
  maxOnlineEvaluations: DEFAULT_LIMIT,
  maxDatasets: DEFAULT_LIMIT,
  maxDashboards: DEFAULT_LIMIT,
  maxCustomGraphs: DEFAULT_LIMIT,
  maxAutomations: DEFAULT_LIMIT,
  canPublish: true,
  usageUnit: "events",
};

/**
 * PRO plan template with standard limits.
 * Used as default when generating PRO licenses.
 */
export const PRO_TEMPLATE: LicensePlanLimits = {
  type: "PRO",
  name: "Pro",
  maxMembers: 10,
  maxMembersLite: 5,
  maxTeams: 10,
  maxProjects: 20,
  maxMessagesPerMonth: 100000,
  evaluationsCredit: 500,
  maxWorkflows: 50,
  maxPrompts: 50,
  maxEvaluators: 50,
  maxScenarios: 50,
  maxAgents: 50,
  maxExperiments: 50,
  maxOnlineEvaluations: 50,
  maxDatasets: 50,
  maxDashboards: 50,
  maxCustomGraphs: 50,
  maxAutomations: 50,
  canPublish: true,
  usageUnit: "events",
};

/**
 * ENTERPRISE plan template with high limits.
 * Used as default when generating ENTERPRISE licenses.
 */
export const ENTERPRISE_TEMPLATE: LicensePlanLimits = {
  type: "ENTERPRISE",
  name: "Enterprise",
  maxMembers: 100,
  maxMembersLite: 50,
  maxTeams: 100,
  maxProjects: 500,
  maxMessagesPerMonth: 10000000,
  evaluationsCredit: 10000,
  maxWorkflows: 1000,
  maxPrompts: 1000,
  maxEvaluators: 1000,
  maxScenarios: 1000,
  maxAgents: 1000,
  maxExperiments: 1000,
  maxOnlineEvaluations: 1000,
  maxDatasets: 1000,
  maxDashboards: 1000,
  maxCustomGraphs: 1000,
  maxAutomations: 1000,
  canPublish: true,
  usageUnit: "events",
};

/**
 * Returns the plan template for a given plan type.
 *
 * @param planType - The plan type (PRO, ENTERPRISE, GROWTH, or CUSTOM)
 * @returns The plan template or null for CUSTOM/unknown types.
 *          GROWTH returns Omit<LicensePlanLimits, "maxMembers"> since
 *          maxMembers must be supplied at generation time.
 */
export function getPlanTemplate(
  planType: string
): LicensePlanLimits | Omit<LicensePlanLimits, "maxMembers"> | null {
  switch (planType) {
    case "GROWTH":
      return GROWTH_TEMPLATE;
    case "PRO":
      return PRO_TEMPLATE;
    case "ENTERPRISE":
      return ENTERPRISE_TEMPLATE;
    default:
      return null;
  }
}
