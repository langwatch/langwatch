import type { PlanInfo } from "./planInfo";
import { resolvePlanDefaults } from "./defaults";
import type { LicenseData } from "./types";

export function mapToPlanInfo(licenseData: LicenseData): PlanInfo {
  const resolved = resolvePlanDefaults(licenseData.plan);

  return {
    type: resolved.type,
    name: resolved.name,
    free: false, // Paid license = not a free tier
    overrideAddingLimitations: false, // Enforce limits, don't bypass
    maxMembers: resolved.maxMembers,
    maxMembersLite: resolved.maxMembersLite,
    maxTeams: resolved.maxTeams,
    maxProjects: resolved.maxProjects,
    maxMessagesPerMonth: resolved.maxMessagesPerMonth,
    evaluationsCredit: resolved.evaluationsCredit,
    maxWorkflows: resolved.maxWorkflows,
    maxPrompts: resolved.maxPrompts,
    maxEvaluators: resolved.maxEvaluators,
    maxScenarios: resolved.maxScenarios,
    maxAgents: resolved.maxAgents,
    maxExperiments: resolved.maxExperiments,
    maxOnlineEvaluations: resolved.maxOnlineEvaluations,
    maxDatasets: resolved.maxDatasets,
    maxDashboards: resolved.maxDashboards,
    maxCustomGraphs: resolved.maxCustomGraphs,
    maxAutomations: resolved.maxAutomations,
    canPublish: resolved.canPublish,
    usageUnit: resolved.usageUnit,
    prices: {
      USD: 0,
      EUR: 0,
    },
  };
}
