import {
  PRO_TEMPLATE,
  ENTERPRISE_TEMPLATE,
} from "../../../ee/licensing/planTemplates";

export type PlanType = "PRO" | "ENTERPRISE" | "CUSTOM";

export interface PlanFormDefaults {
  maxMembers?: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  canPublish?: boolean;
  usageUnit?: "traces" | "events";
}

/**
 * Record map of plan defaults following OCP - add new plans without modifying existing code.
 * Templates already define all values, no fallbacks needed.
 *
 * Only the enforced levers (seats, messages) + identity are templated — projects,
 * teams, and experimentation resources are OSS/uncapped and not part of licenses.
 */
export const PLAN_DEFAULTS: Record<PlanType, PlanFormDefaults> = {
  PRO: {
    maxMembers: PRO_TEMPLATE.maxMembers,
    maxMembersLite: PRO_TEMPLATE.maxMembersLite,
    maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
    canPublish: PRO_TEMPLATE.canPublish,
    usageUnit: PRO_TEMPLATE.usageUnit as "traces" | "events",
  },
  ENTERPRISE: {
    maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
    maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite,
    maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
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
