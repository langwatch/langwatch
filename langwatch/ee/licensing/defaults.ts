import { DEFAULT_LIMIT, DEFAULT_MEMBERS_LITE } from "./constants";
import type { LicensePlanLimits } from "./types";

const KNOWN_USAGE_UNITS = ["traces", "events"] as const;

/**
 * ResolvedPlanLimits has all optional fields made required after defaults are applied.
 * This provides compile-time safety that all limits have defined values.
 */
export type ResolvedPlanLimits = Required<LicensePlanLimits>;

/**
 * Applies default values to optional fields in LicensePlanLimits.
 *
 * This consolidates scattered nullish coalescing operations into a single function.
 * Optional fields that may be missing in older licenses receive sensible defaults:
 * - maxMembersLite: DEFAULT_MEMBERS_LITE (1)
 * - maxPrompts: DEFAULT_LIMIT (Number.MAX_SAFE_INTEGER - effectively unlimited)
 * - maxEvaluators: DEFAULT_LIMIT (effectively unlimited)
 * - maxScenarios: DEFAULT_LIMIT (effectively unlimited)
 * - usageUnit: "traces"
 *
 * @param plan - License plan limits with optional fields
 * @returns Plan limits with all fields guaranteed to have values
 */
export function resolvePlanDefaults(plan: LicensePlanLimits): ResolvedPlanLimits {
  return {
    // Pass through required fields unchanged
    type: plan.type,
    name: plan.name,
    maxMembers: plan.maxMembers,
    maxProjects: plan.maxProjects,
    maxMessagesPerMonth: plan.maxMessagesPerMonth,
    evaluationsCredit: plan.evaluationsCredit,
    maxWorkflows: plan.maxWorkflows,
    canPublish: plan.canPublish,

    // Apply defaults to optional fields
    maxMembersLite: plan.maxMembersLite ?? DEFAULT_MEMBERS_LITE,
    maxTeams: plan.maxTeams ?? DEFAULT_LIMIT,
    maxPrompts: plan.maxPrompts ?? DEFAULT_LIMIT,
    maxEvaluators: plan.maxEvaluators ?? DEFAULT_LIMIT,
    maxScenarios: plan.maxScenarios ?? DEFAULT_LIMIT,
    maxAgents: plan.maxAgents ?? DEFAULT_LIMIT,
    maxExperiments: plan.maxExperiments ?? DEFAULT_LIMIT,
    maxOnlineEvaluations: plan.maxOnlineEvaluations ?? DEFAULT_LIMIT,
    maxDatasets: plan.maxDatasets ?? DEFAULT_LIMIT,
    maxDashboards: plan.maxDashboards ?? DEFAULT_LIMIT,
    maxCustomGraphs: plan.maxCustomGraphs ?? DEFAULT_LIMIT,
    maxAutomations: plan.maxAutomations ?? DEFAULT_LIMIT,
    usageUnit: KNOWN_USAGE_UNITS.includes(plan.usageUnit as any)
      ? plan.usageUnit!
      : "traces",
  };
}
