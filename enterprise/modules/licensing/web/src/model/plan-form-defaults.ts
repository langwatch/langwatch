import { ENTERPRISE_TEMPLATE, PRO_TEMPLATE, templateFormDefaults } from "@langwatch/plans";

export type PlanType = "PRO" | "ENTERPRISE" | "CUSTOM";

export interface PlanFormDefaults {
  maxMembers?: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  canPublish?: boolean;
  webhookEndpointsEnabled?: boolean;
  usageUnit?: "traces" | "events";
}

/**
 * Mint form defaults for each plan type. All keys present even when undefined
 * so the form doesn't carry forward previous values. CUSTOM answers nothing
 * (operator-determined only).
 */
export const PLAN_DEFAULTS: Record<PlanType, PlanFormDefaults> = {
  PRO: {
    ...templateFormDefaults(PRO_TEMPLATE),
    usageUnit: PRO_TEMPLATE.usageUnit as "traces" | "events",
  },
  ENTERPRISE: {
    ...templateFormDefaults(ENTERPRISE_TEMPLATE),
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
