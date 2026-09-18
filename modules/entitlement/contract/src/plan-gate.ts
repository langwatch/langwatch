import { EnterprisePlanRequiredError, isEnterpriseTier } from "./plan-gate.errors.ts";
import type { PlanProvider, PlanProviderUser } from "./provider.ts";

/**
 * Kept structural so this Enterprise check does not depend on the application container.
 */
type EnterpriseGateMiddlewareParams<TNextReturn> = {
  ctx: {
    app: { planProvider: PlanProvider };
    session?: { user?: PlanProviderUser } | null;
  };
  input: { organizationId: string };
  next: () => TNextReturn;
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
    throw new EnterprisePlanRequiredError(errorMessage);
  }
}

/**
 * Accepts the plan lookup explicitly so transports, workers, and tests share this check.
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
  async <TNextReturn>({
    ctx,
    input,
    next,
  }: EnterpriseGateMiddlewareParams<TNextReturn>): Promise<TNextReturn> => {
    await assertEnterprisePlan({
      planProvider: ctx.app.planProvider,
      organizationId: input.organizationId,
      user: ctx.session?.user,
      errorMessage,
    });
    return next();
  };
