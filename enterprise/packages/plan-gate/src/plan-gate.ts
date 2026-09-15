import type { PlanProvider, PlanProviderUser } from "@langwatch/entitlement-contract";
import { TRPCError } from "@trpc/server";

import { isEnterpriseTier } from "./plan-gate.errors.ts";

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

/** Fail-closed check: refuses all non-Enterprise plans (unknown tiers included). */
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

/** tRPC middleware (403); compose after RBAC check so RBAC denial fires first
 * (clearer error attribution).
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
