import type { SelfHostedPlan } from "@langwatch/ee/license";
import type { Entitlement } from "./constants";

/**
 * All plans that can have entitlements assigned.
 * Currently only self-hosted plans, but can be extended for SaaS tiers.
 */
export type Plan = SelfHostedPlan;

/**
 * Base entitlements available to all plans (including OSS).
 */
const baseEntitlements: Entitlement[] = [
  "sso-google",
  "sso-github",
  "sso-gitlab",
];

/**
 * Enterprise-only entitlements.
 */
const enterpriseEntitlements: Entitlement[] = ["custom-rbac"];

/**
 * Exhaustive type check helper.
 * If this function is called at runtime, it means a case was not handled.
 * TypeScript will error at compile time if any plan is not handled in a switch.
 */
function assertUnreachable(x: never): never {
  throw new Error(`Unhandled plan type: ${x}`);
}

/**
 * Gets all entitlements for a given plan.
 * Uses exhaustive switch to ensure all plans are handled at compile time.
 *
 * @param plan - The plan to get entitlements for
 * @returns Array of entitlements the plan has access to
 */
export function getEntitlementsForPlan(plan: Plan): Entitlement[] {
  switch (plan) {
    case "self-hosted:oss":
      return [...baseEntitlements];
    case "self-hosted:pro":
      return [...baseEntitlements];
    case "self-hosted:enterprise":
      return [...baseEntitlements, ...enterpriseEntitlements];
    default:
      return assertUnreachable(plan);
  }
}
