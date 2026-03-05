import type { LicensePlanLimits } from "./types";

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
  usageUnit: "traces",
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
  usageUnit: "traces",
};

/**
 * Returns the plan template for a given plan type.
 *
 * @param planType - The plan type (PRO, ENTERPRISE, or CUSTOM)
 * @returns The plan template or null for CUSTOM/unknown types
 */
export function getPlanTemplate(planType: string): LicensePlanLimits | null {
  switch (planType) {
    case "PRO":
      return PRO_TEMPLATE;
    case "ENTERPRISE":
      return ENTERPRISE_TEMPLATE;
    default:
      return null;
  }
}
