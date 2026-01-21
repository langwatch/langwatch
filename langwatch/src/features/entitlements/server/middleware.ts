import { TRPCError } from "@trpc/server";
import { getSelfHostedPlan } from "@langwatch/ee/license";
import type { Entitlement } from "../constants";
import { hasEntitlement } from "./hasEntitlement";

/**
 * Creates a tRPC middleware that checks for a required entitlement.
 *
 * Usage:
 * ```ts
 * .use(checkEntitlement("custom-rbac"))
 * ```
 *
 * @param entitlement - The entitlement to check for
 * @returns A tRPC middleware function
 */
export function checkEntitlement(entitlement: Entitlement) {
  return async <T extends { next: () => Promise<unknown> }>({
    next,
  }: T): Promise<unknown> => {
    const plan = getSelfHostedPlan();

    if (!hasEntitlement(plan, entitlement)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This feature requires the "${entitlement}" entitlement. Please upgrade to LangWatch Enterprise.`,
      });
    }

    return next();
  };
}
