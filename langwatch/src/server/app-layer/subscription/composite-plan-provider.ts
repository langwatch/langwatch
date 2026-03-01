import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { isAdmin } from "../../../../ee/billing/planProvider";
import type { PlanProvider, PlanProviderUser } from "./plan-provider";

/**
 * Composite PlanProvider with select-one semantics.
 *
 * Precedence:
 *   1. License override — if the org has a valid (non-free) license, use it entirely
 *   2. SaaS provider — Stripe subscription-based plan
 *
 * After selection, `overrideAddingLimitations` is recomputed from the user's
 * impersonation context — it is authorization, not entitlement.
 */
export function createCompositePlanProvider({
  licensePlanProvider,
  saasPlanProvider,
}: {
  licensePlanProvider: PlanProvider;
  saasPlanProvider: PlanProvider;
}): PlanProvider {
  return {
    async getActivePlan({ organizationId, user }) {
      // 1. Try license override
      const licensePlan =
        await licensePlanProvider.getActivePlan({ organizationId });

      const selectedPlan: PlanInfo = licensePlan.free
        ? // 2. License is free/absent — fall through to SaaS
          await saasPlanProvider.getActivePlan({ organizationId, user })
        : // License is valid — use it as the complete plan
          licensePlan;

      // 3. Recompute overrideAddingLimitations from user context (not plan source)
      return {
        ...selectedPlan,
        overrideAddingLimitations: computeOverrideAddingLimitations(user),
      };
    },
  };
}

function computeOverrideAddingLimitations(
  user?: PlanProviderUser,
): boolean {
  return !!user?.impersonator && isAdmin(user.impersonator);
}
