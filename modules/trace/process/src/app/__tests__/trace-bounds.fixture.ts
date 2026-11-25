import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";

const TIER_PLAN_TYPE = {
  free: "FREE",
  paid: "PRO",
  enterprise: "ENTERPRISE",
} as const;

/**
 * The request-bound half of the entitlement peer, answering every bound on
 * one tier. Tests that assert clamp/refuse behavior pick the tier; the rest
 * take the free default; `overrides` stands in for an operator's configured bound.
 */
export function createTraceTestRequestBounds(
  tier: keyof typeof TIER_PLAN_TYPE = "free",
  overrides: Partial<Record<RequestBoundKey, number>> = {},
): Pick<EntitlementApi, "requestBound"> {
  return {
    requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
      Promise.resolve(overrides[key] ?? resolveRequestBound(key, TIER_PLAN_TYPE[tier])),
  };
}
