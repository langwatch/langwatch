import {
  PRO_TEMPLATE,
  ENTERPRISE_TEMPLATE,
} from "../../../ee/licensing/planTemplates";

export type PlanType = "PRO" | "ENTERPRISE" | "CUSTOM";

export interface PlanFormDefaults {
  maxMembers?: number;
  maxMembersLite?: number;
  maxProjects?: number;
  maxMessagesPerMonth?: number;
  evaluationsCredit?: number;
  maxWorkflows?: number;
  maxPrompts?: number;
  maxEvaluators?: number;
  maxScenarios?: number;
  maxAgents?: number;
  canPublish?: boolean;
  usageUnit?: "traces" | "events";
}

/**
 * Record map of plan defaults following OCP - add new plans without modifying existing code.
 * Templates already define all values, no fallbacks needed.
 */
export const PLAN_DEFAULTS: Record<PlanType, PlanFormDefaults> = {
  PRO: {
    maxMembers: PRO_TEMPLATE.maxMembers,
    maxMembersLite: PRO_TEMPLATE.maxMembersLite,
    maxProjects: PRO_TEMPLATE.maxProjects,
    maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
    evaluationsCredit: PRO_TEMPLATE.evaluationsCredit,
    maxWorkflows: PRO_TEMPLATE.maxWorkflows,
    maxPrompts: PRO_TEMPLATE.maxPrompts,
    maxEvaluators: PRO_TEMPLATE.maxEvaluators,
    maxScenarios: PRO_TEMPLATE.maxScenarios,
    maxAgents: PRO_TEMPLATE.maxAgents,
    canPublish: PRO_TEMPLATE.canPublish,
    usageUnit: PRO_TEMPLATE.usageUnit as "traces" | "events",
  },
  ENTERPRISE: {
    maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
    maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite,
    maxProjects: ENTERPRISE_TEMPLATE.maxProjects,
    maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
    evaluationsCredit: ENTERPRISE_TEMPLATE.evaluationsCredit,
    maxWorkflows: ENTERPRISE_TEMPLATE.maxWorkflows,
    maxPrompts: ENTERPRISE_TEMPLATE.maxPrompts,
    maxEvaluators: ENTERPRISE_TEMPLATE.maxEvaluators,
    maxScenarios: ENTERPRISE_TEMPLATE.maxScenarios,
    maxAgents: ENTERPRISE_TEMPLATE.maxAgents,
    canPublish: ENTERPRISE_TEMPLATE.canPublish,
    usageUnit: ENTERPRISE_TEMPLATE.usageUnit as "traces" | "events",
  },
  CUSTOM: {},
};

/**
 * Returns the form defaults for a given plan type.
 * Uses a Record map pattern for OCP compliance - adding new plans
 * requires only adding an entry to PLAN_DEFAULTS.
 */
export function getPlanDefaults(planType: PlanType): PlanFormDefaults {
  return PLAN_DEFAULTS[planType];
}
