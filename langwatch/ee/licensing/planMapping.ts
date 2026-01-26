import type { PlanInfo } from "~/server/subscriptionHandler";
import { DEFAULT_LIMIT, DEFAULT_MEMBERS_LITE } from "./constants";
import type { LicenseData } from "./types";

export function mapToPlanInfo(licenseData: LicenseData): PlanInfo {
  const { plan } = licenseData;

  return {
    type: plan.type,
    name: plan.name,
    free: false, // Paid license = not a free tier
    overrideAddingLimitations: false, // Enforce limits, don't bypass
    maxMembers: plan.maxMembers,
    maxMembersLite: plan.maxMembersLite ?? DEFAULT_MEMBERS_LITE,
    maxProjects: plan.maxProjects,
    maxMessagesPerMonth: plan.maxMessagesPerMonth,
    evaluationsCredit: plan.evaluationsCredit,
    maxWorkflows: plan.maxWorkflows,
    // New fields with defaults for backward compatibility with existing licenses
    maxPrompts: plan.maxPrompts ?? DEFAULT_LIMIT,
    maxEvaluators: plan.maxEvaluators ?? DEFAULT_LIMIT,
    maxScenarios: plan.maxScenarios ?? DEFAULT_LIMIT,
    canPublish: plan.canPublish,
    prices: {
      USD: 0,
      EUR: 0,
    },
  };
}
