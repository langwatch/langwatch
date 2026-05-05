import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { isAdmin } from "../../../../ee/billing/planProvider";
import { PLAN_LIMITS } from "../../../../ee/billing/planLimits";
import { PlanTypes } from "../../../../ee/billing/planTypes";
import { env } from "~/env.mjs";
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

      // 2. Select plan source — composite is the single canonical authority for planSource
      let selectedPlan: PlanInfo;
      if (licensePlan.free) {
        // License is free/absent — fall through to SaaS
        const saasPlan = await saasPlanProvider.getActivePlan({ organizationId, user });
        selectedPlan = { ...saasPlan, planSource: saasPlan.free ? "free" : "subscription" };
      } else {
        // License is valid — use it as the complete plan
        selectedPlan = { ...licensePlan, planSource: "license" };
      }

      // 3. Self-hosted dev bypass — when LANGWATCH_DEV_FORCE_ENTERPRISE=true,
      // surface ENTERPRISE limits everywhere (including the license-
      // enforcement guard at member/team/project create time). Previously
      // this bypass only patched the UI display in usage-stats.service.ts,
      // so server-side enforcement still rejected with 'reached the
      // limit of 1 team members' on dogfood installs (Ariana's option-C
      // sweep blocker — couldn't test team-scoped tile overrides,
      // multi-user budgets, RBAC delegation, anomaly scope:USER).
      // No effect on SaaS deploys or NODE_ENV=test.
      const devForceEnterprise =
        env.NODE_ENV !== "test" &&
        !env.IS_SAAS &&
        env.LANGWATCH_DEV_FORCE_ENTERPRISE === true;
      if (devForceEnterprise) {
        selectedPlan = {
          ...PLAN_LIMITS[PlanTypes.ENTERPRISE],
          planSource: selectedPlan.planSource,
          overrideAddingLimitations: selectedPlan.overrideAddingLimitations,
        };
      }

      // 4. Recompute overrideAddingLimitations from user context (not plan source)
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
