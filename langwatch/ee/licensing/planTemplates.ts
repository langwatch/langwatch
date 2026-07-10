import {
  ENTERPRISE_LICENSE_TEMPLATE,
  GROWTH_LICENSE_TEMPLATE,
  PRO_LICENSE_TEMPLATE,
} from "../plan-constants";
import type { LicensePlanLimits } from "./types";

/**
 * License-generation plan templates. Values live in `ee/plan-constants.ts`
 * (ADR-039 Decision 7): one module declares both the license and SaaS
 * variants of every plan so their values can no longer drift silently.
 */

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
      return GROWTH_LICENSE_TEMPLATE;
    case "PRO":
      return PRO_LICENSE_TEMPLATE;
    case "ENTERPRISE":
      return ENTERPRISE_LICENSE_TEMPLATE;
    default:
      return null;
  }
}
