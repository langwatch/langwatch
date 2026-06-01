import type { PlanInfo } from "./planInfo";
import { resolvePlanDefaults } from "./defaults";
import type { LicenseData } from "./types";

export function mapToPlanInfo(licenseData: LicenseData): PlanInfo {
  const resolved = resolvePlanDefaults(licenseData.plan);

  return {
    planSource: "license",
    type: resolved.type,
    name: resolved.name,
    free: false, // Paid license = not a free tier
    overrideAddingLimitations: false, // Enforce limits, don't bypass
    maxMembers: resolved.maxMembers,
    maxMembersLite: resolved.maxMembersLite,
    maxTeams: resolved.maxTeams,
    maxProjects: resolved.maxProjects,
    maxMessagesPerMonth: resolved.maxMessagesPerMonth,
    canPublish: resolved.canPublish,
    usageUnit: resolved.usageUnit,
    prices: {
      USD: 0,
      EUR: 0,
    },
  };
}
