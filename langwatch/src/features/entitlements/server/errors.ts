import { TRPCError } from "@trpc/server";
import { createLogger } from "~/utils/logger";
import type { Entitlement } from "../constants";
import type { Plan } from "../plans";

const logger = createLogger("entitlements");

/**
 * Creates a standardized FORBIDDEN error for missing entitlements.
 * Logs the entitlement check failure for debugging and audit purposes.
 *
 * @param entitlement - The missing entitlement
 * @param plan - The plan that was checked (optional, for logging)
 * @returns TRPCError with FORBIDDEN code
 */
export function createEntitlementError(
  entitlement: Entitlement,
  plan?: Plan
): TRPCError {
  logger.warn(
    { entitlement, plan },
    `Entitlement check failed: "${entitlement}" not available for plan "${plan ?? "unknown"}"`
  );

  return new TRPCError({
    code: "FORBIDDEN",
    message: `This feature requires the "${entitlement}" entitlement. Please upgrade your plan.`,
  });
}
