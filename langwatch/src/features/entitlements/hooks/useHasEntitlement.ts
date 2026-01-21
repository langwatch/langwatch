import { DEFAULT_PLAN, isValidPlan } from "@langwatch/ee/license";
import type { Entitlement } from "../constants";
import { getEntitlementsForPlan, type Plan } from "../plans";
import { api } from "../../../utils/api";

/**
 * Safely extracts and validates the plan from publicEnv data.
 *
 * @param publicEnv - The public env data or undefined
 * @returns The validated plan or DEFAULT_PLAN
 */
function getPlanFromPublicEnv(
  publicEnv: { SELF_HOSTED_PLAN?: unknown } | undefined
): Plan {
  if (!publicEnv) {
    return DEFAULT_PLAN;
  }

  const rawPlan = publicEnv.SELF_HOSTED_PLAN;
  return isValidPlan(rawPlan) ? rawPlan : DEFAULT_PLAN;
}

/**
 * React hook that checks if the current deployment has a specific entitlement.
 *
 * Uses the public env to get the current plan and checks entitlements client-side.
 *
 * @param entitlement - The entitlement to check for
 * @returns true if the deployment has the entitlement, false otherwise
 */
export function useHasEntitlement(entitlement: Entitlement): boolean {
  const { data: publicEnv } = api.publicEnv.useQuery({});

  if (!publicEnv) {
    // Default to true while loading to avoid flashing locked UI
    return true;
  }

  const plan = getPlanFromPublicEnv(publicEnv);
  const planEntitlements = getEntitlementsForPlan(plan);

  return planEntitlements.includes(entitlement);
}

/**
 * React hook that returns the current plan.
 *
 * @returns The current plan or undefined while loading
 */
export function useCurrentPlan(): Plan | undefined {
  const { data: publicEnv } = api.publicEnv.useQuery({});

  if (!publicEnv) {
    return undefined;
  }

  return getPlanFromPublicEnv(publicEnv);
}
