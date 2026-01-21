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
 * Mapping of plans to their entitled features.
 */
const planEntitlements: Record<Plan, Entitlement[]> = {
  "self-hosted:oss": [...baseEntitlements],
  "self-hosted:pro": [...baseEntitlements],
  "self-hosted:enterprise": [...baseEntitlements, ...enterpriseEntitlements],
};

/**
 * Gets all entitlements for a given plan.
 *
 * @param plan - The plan to get entitlements for
 * @returns Array of entitlements the plan has access to
 */
export function getEntitlementsForPlan(plan: Plan): Entitlement[] {
  return planEntitlements[plan];
}
