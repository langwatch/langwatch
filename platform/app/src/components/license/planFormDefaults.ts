import {
  ENTERPRISE_TEMPLATE,
  PRO_TEMPLATE,
} from "../../../ee/licensing/planTemplates";

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
 * What the mint form fills in for each plan the operator can pick. Templates
 * already define all values, no fallbacks needed.
 *
 * Only the enforced levers (seats, messages, entitlements) + identity are
 * templated — projects, teams, and experimentation resources are OSS/uncapped
 * and not part of licenses.
 *
 * Every key a template answers is present here even when its value is
 * undefined: the form spreads these over what is already typed in, so a key
 * left out would keep the previous plan's value after switching plans.
 * CUSTOM answers nothing on purpose. It has no tier to inherit from and no
 * tier decides its entitlements later, so what the operator ticks is the only
 * thing a custom contract carries.
 */
export const PLAN_DEFAULTS: Record<PlanType, PlanFormDefaults> = {
  PRO: {
    maxMembers: PRO_TEMPLATE.maxMembers,
    maxMembersLite: PRO_TEMPLATE.maxMembersLite,
    maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
    canPublish: PRO_TEMPLATE.canPublish,
    webhookEndpointsEnabled: PRO_TEMPLATE.webhookEndpointsEnabled,
    usageUnit: PRO_TEMPLATE.usageUnit as "traces" | "events",
  },
  ENTERPRISE: {
    maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
    maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite,
    maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
    canPublish: ENTERPRISE_TEMPLATE.canPublish,
    webhookEndpointsEnabled: ENTERPRISE_TEMPLATE.webhookEndpointsEnabled,
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
