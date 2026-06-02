import type { LicensePlanLimits } from "./types";
import { DEFAULT_LIMIT } from "./constants";

/**
 * Plan templates only carry the limits that licenses actually encode now:
 * member seats (maxMembers, maxMembersLite), messages volume, and identity
 * (type, name, canPublish, usageUnit). Workspace structure (projects, teams)
 * and experimentation resources are OSS/uncapped and are NOT part of licenses,
 * so they are not templated or minted.
 */

/**
 * GROWTH plan template with unlimited limits except maxMembers.
 * maxMembers must be supplied at generation time (from Stripe seat quantity).
 * Used for self-serving license purchases.
 */
export const GROWTH_TEMPLATE: Omit<LicensePlanLimits, "maxMembers"> = {
  type: "GROWTH",
  name: "Growth",
  maxMembersLite: DEFAULT_LIMIT,
  maxMessagesPerMonth: DEFAULT_LIMIT,
  canPublish: true,
  usageUnit: "events",
};

/**
 * PRO plan template with standard limits.
 * Used as default when generating PRO licenses.
 */
export const PRO_TEMPLATE: LicensePlanLimits = {
  type: "PRO",
  name: "Pro",
  maxMembers: 10,
  maxMembersLite: 5,
  maxMessagesPerMonth: 100000,
  canPublish: true,
  usageUnit: "traces",
};

/**
 * ENTERPRISE plan template with high limits.
 * Used as default when generating ENTERPRISE licenses.
 */
export const ENTERPRISE_TEMPLATE: LicensePlanLimits = {
  type: "ENTERPRISE",
  name: "Enterprise",
  maxMembers: 100,
  maxMembersLite: 50,
  maxMessagesPerMonth: 10000000,
  canPublish: true,
  usageUnit: "traces",
};

/**
 * Returns the plan template for a given plan type.
 *
 * @param planType - The plan type (PRO, ENTERPRISE, GROWTH, or CUSTOM)
 * @returns The plan template or null for CUSTOM/unknown types.
 *          GROWTH returns Omit<LicensePlanLimits, "maxMembers"> since
 *          maxMembers must be supplied at generation time.
 */
export function getPlanTemplate(
  planType: string
): LicensePlanLimits | Omit<LicensePlanLimits, "maxMembers"> | null {
  switch (planType) {
    case "GROWTH":
      return GROWTH_TEMPLATE;
    case "PRO":
      return PRO_TEMPLATE;
    case "ENTERPRISE":
      return ENTERPRISE_TEMPLATE;
    default:
      return null;
  }
}
