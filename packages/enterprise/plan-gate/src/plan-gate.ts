import type { PlanProvider, PlanProviderUser } from "@langwatch/entitlement-contract";
import { TRPCError } from "@trpc/server";

import { isEnterpriseTier } from "./plan-gate.errors";

/**
 * The shape a tRPC procedure presents to the gate.
 *
 * Structural rather than imported: the gate needs the plan lookup and the
 * organization the call names, and nothing else about the process's context.
 * Naming the real context type here would put the whole application container
 * behind an Enterprise package.
 */
type EnterpriseGateMiddlewareParams = {
  ctx: {
    app: { planProvider: PlanProvider };
    session?: { user?: PlanProviderUser } | null;
  };
  input: { organizationId: string };
  next: () => any;
};

/**
 * Refuse a resolved plan that is not Enterprise.
 *
 * Fail-closed by construction: it asks whether the plan IS Enterprise, so
 * every other answer — the cloud free tier, the unlicensed self-hosted
 * baseline, a paid tier below Enterprise, a tier that did not exist when this
 * was written — refuses. A lookup that fails never reaches here at all: the
 * rejection propagates out of the caller.
 */
export function assertEnterprisePlanType({
  planType,
  errorMessage,
}: {
  planType: string;
  errorMessage: string;
}): void {
  if (!isEnterpriseTier(planType)) {
    throw new TRPCError({ code: "FORBIDDEN", message: errorMessage });
  }
}

/**
 * Resolve the organization's active plan and refuse unless it is Enterprise.
 *
 * Takes the plan lookup as an argument rather than reaching for a container,
 * so the same check runs from a tRPC procedure, a REST handler, a worker or a
 * test without any of them sharing a process.
 */
export async function assertEnterprisePlan({
  planProvider,
  organizationId,
  user,
  errorMessage,
}: {
  planProvider: PlanProvider;
  organizationId: string;
  user?: PlanProviderUser;
  errorMessage: string;
}): Promise<void> {
  const plan = await planProvider.getActivePlan({
    organizationId,
    user,
  });

  assertEnterprisePlanType({ planType: plan.type, errorMessage });
}

/**
 * tRPC middleware that 403s any procedure whose org isn't on an
 * Enterprise plan. Compose AFTER `checkOrganizationPermission` so the
 * RBAC denial fires first (UNAUTHORIZED before FORBIDDEN — clearer
 * error attribution: "you don't have access to the org" trumps "your
 * org doesn't have the feature").
 *
 * Usage:
 *   procedure
 *     .use(checkOrganizationPermission("anomalyRules:view"))
 *     .use(requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.ANOMALY_RULES))
 *     .query(...)
 */
export const requireEnterprisePlan =
  (errorMessage: string) =>
  async ({ ctx, input, next }: EnterpriseGateMiddlewareParams) => {
    await assertEnterprisePlan({
      planProvider: ctx.app.planProvider,
      organizationId: input.organizationId,
      user: ctx.session?.user,
      errorMessage,
    });
    return next();
  };
