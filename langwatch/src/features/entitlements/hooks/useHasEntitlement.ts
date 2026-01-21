import type { Entitlement } from "../constants";
import { getEntitlementsForPlan, type Plan } from "../plans";
import { api } from "../../../utils/api";

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

  const plan = (publicEnv.SELF_HOSTED_PLAN ?? "self-hosted:oss") as Plan;
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

  return (publicEnv.SELF_HOSTED_PLAN ?? "self-hosted:oss") as Plan;
}
