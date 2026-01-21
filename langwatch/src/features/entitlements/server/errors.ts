import { TRPCError } from "@trpc/server";
import type { Entitlement } from "../constants";

/**
 * Creates a standardized FORBIDDEN error for missing entitlements.
 *
 * @param entitlement - The missing entitlement
 * @returns TRPCError with FORBIDDEN code
 */
export function createEntitlementError(entitlement: Entitlement): TRPCError {
  return new TRPCError({
    code: "FORBIDDEN",
    message: `This feature requires the "${entitlement}" entitlement. Please upgrade your plan.`,
  });
}
