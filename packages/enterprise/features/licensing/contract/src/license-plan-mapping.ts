import type { LicenseData } from "./license.ts";
import { resolvePlanDefaults } from "./license-plan-defaults.ts";
import type { PlanInfo } from "./license-plan.ts";

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
    maxMessagesPerMonth: resolved.maxMessagesPerMonth,
    canPublish: resolved.canPublish,
    webhookEndpointsEnabled: resolved.webhookEndpointsEnabled,
    usageUnit: resolved.usageUnit,
    prices: {
      USD: 0,
      EUR: 0,
    },
  };
}
