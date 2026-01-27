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
  maxProjects: 20,
  maxMessagesPerMonth: 100000,
  evaluationsCredit: 500,
  maxWorkflows: 50,
  maxPrompts: 50,
  maxEvaluators: 50,
  maxScenarios: 50,
  canPublish: true,
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
  maxProjects: 500,
  maxMessagesPerMonth: 10000000,
  evaluationsCredit: 10000,
  maxWorkflows: 1000,
  maxPrompts: 1000,
  maxEvaluators: 1000,
  maxScenarios: 1000,
  canPublish: true,
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
