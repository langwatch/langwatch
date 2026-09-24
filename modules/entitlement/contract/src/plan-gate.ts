import { EnterprisePlanRequiredError, isEnterpriseTier } from "./plan-gate.errors.ts";
import type { PlanProvider, PlanProviderUser } from "./provider.ts";

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
