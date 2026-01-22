import type { PlanInfo } from "~/server/subscriptionHandler";
import type { LicenseData } from "./types";

/**
 * Maps license data to a PlanInfo structure compatible with the subscription system.
 *
 * @param licenseData - The license data containing plan limits
 * @returns PlanInfo for use with existing enforcement code
 */
export function mapToPlanInfo(licenseData: LicenseData): PlanInfo {
  const { plan } = licenseData;

  return {
    type: plan.type,
    name: plan.name,
    free: false, // Licensed plans are never free
    overrideAddingLimitations: false, // Licenses don't override limits
    maxMembers: plan.maxMembers,
    maxProjects: plan.maxProjects,
    maxMessagesPerMonth: plan.maxMessagesPerMonth,
    evaluationsCredit: plan.evaluationsCredit,
    maxWorkflows: plan.maxWorkflows,
    canPublish: plan.canPublish,
    prices: {
      USD: 0,
      EUR: 0,
    },
  };
}
