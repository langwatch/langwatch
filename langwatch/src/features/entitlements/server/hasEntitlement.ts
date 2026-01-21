import { TRPCError } from "@trpc/server";
import { getSelfHostedPlan } from "@langwatch/ee/license";
import type { Entitlement } from "../constants";
import { getEntitlementsForPlan, type Plan } from "../plans";

/**
 * Checks if a plan has access to a specific entitlement.
 *
 * @param plan - The plan to check
 * @param entitlement - The entitlement to check for
 * @returns true if the plan has the entitlement
 */
export function hasEntitlement(plan: Plan, entitlement: Entitlement): boolean {
  const planEntitlements = getEntitlementsForPlan(plan);
  return planEntitlements.includes(entitlement);
}

/**
 * Checks if the current deployment has a specific entitlement.
 * Uses the LICENSE_KEY environment variable to determine the plan.
 *
 * @param entitlement - The entitlement to check for
 * @returns true if the deployment has the entitlement
 */
export function hasEntitlementForCurrentPlan(
  entitlement: Entitlement
): boolean {
  const plan = getSelfHostedPlan();
  return hasEntitlement(plan, entitlement);
}

/**
 * Requires a specific entitlement or throws a FORBIDDEN error.
 *
 * @param plan - The plan to check
 * @param entitlement - The required entitlement
 * @throws TRPCError with code FORBIDDEN if entitlement is missing
 */
export function requireEntitlement(
  plan: Plan,
  entitlement: Entitlement
): void {
  if (!hasEntitlement(plan, entitlement)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This feature requires the "${entitlement}" entitlement. Please upgrade your plan.`,
    });
  }
}

/**
 * Requires a specific entitlement for the current deployment or throws.
 *
 * @param entitlement - The required entitlement
 * @throws TRPCError with code FORBIDDEN if entitlement is missing
 */
export function requireEntitlementForCurrentPlan(
  entitlement: Entitlement
): void {
  const plan = getSelfHostedPlan();
  requireEntitlement(plan, entitlement);
}
