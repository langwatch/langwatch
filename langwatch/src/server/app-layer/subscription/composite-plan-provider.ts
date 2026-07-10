import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { isAdmin } from "../../../../ee/billing/planProvider";
import type { PlanProvider, PlanProviderUser } from "./plan-provider";

/**
 * Composite PlanProvider with select-one semantics.
 *
 * Legacy precedence (flag off):
 *   1. License override — if the org has a valid (non-free) license, use it entirely
 *   2. SaaS provider — Stripe subscription-based plan
 *
 * Rank precedence (ADR-039 Decision 1, behind `release_billing_precedence_rank`):
 *   ENTERPRISE license > active subscription > non-ENTERPRISE license > free.
 *   An active subscription must beat a stale GROWTH/PRO license (the
 *   seat-flow dead-end class), while a sales-issued ENTERPRISE license must
 *   survive a leftover self-serve subscription.
 *
 * After selection, `overrideAddingLimitations` is recomputed from the user's
 * impersonation context — it is authorization, not entitlement.
 */
export function createCompositePlanProvider({
  licensePlanProvider,
  saasPlanProvider,
  isPrecedenceRankEnabled,
}: {
  licensePlanProvider: PlanProvider;
  saasPlanProvider: PlanProvider;
  /**
   * Reads the `release_billing_precedence_rank` flag (ADR-039 Decision 12).
   * Absent or false = legacy license-always-wins precedence.
   */
  isPrecedenceRankEnabled?: (organizationId: string) => Promise<boolean>;
}): PlanProvider {
  return {
    async getActivePlan({ organizationId, user }) {
      const licensePlan = await licensePlanProvider.getActivePlan({
        organizationId,
      });

      const rankEnabled =
        (await isPrecedenceRankEnabled?.(organizationId)) ?? false;

      const selectedPlan = rankEnabled
        ? await selectByRank({
            licensePlan,
            saasPlanProvider,
            organizationId,
            user,
          })
        : await selectLegacy({
            licensePlan,
            saasPlanProvider,
            organizationId,
            user,
          });

      // Recompute overrideAddingLimitations from user context (not plan source)
      return {
        ...selectedPlan,
        overrideAddingLimitations: computeOverrideAddingLimitations(user),
      };
    },
  };
}

/** Legacy select-one: a valid (non-free) license beats everything. */
async function selectLegacy({
  licensePlan,
  saasPlanProvider,
  organizationId,
  user,
}: {
  licensePlan: PlanInfo;
  saasPlanProvider: PlanProvider;
  organizationId: string;
  user?: PlanProviderUser;
}): Promise<PlanInfo> {
  if (!licensePlan.free) {
    return { ...licensePlan, planSource: "license" };
  }
  const saasPlan = await saasPlanProvider.getActivePlan({
    organizationId,
    user,
  });
  return {
    ...saasPlan,
    planSource: saasPlan.free ? "free" : "subscription",
  };
}

/**
 * ADR-039 rank: ENTERPRISE license > active subscription >
 * non-ENTERPRISE license > free. An expired/invalid license resolves free
 * from the license provider and therefore never wins.
 */
async function selectByRank({
  licensePlan,
  saasPlanProvider,
  organizationId,
  user,
}: {
  licensePlan: PlanInfo;
  saasPlanProvider: PlanProvider;
  organizationId: string;
  user?: PlanProviderUser;
}): Promise<PlanInfo> {
  const hasValidLicense = !licensePlan.free;

  if (hasValidLicense && licensePlan.type === "ENTERPRISE") {
    return { ...licensePlan, planSource: "license" };
  }

  const saasPlan = await saasPlanProvider.getActivePlan({
    organizationId,
    user,
  });
  if (!saasPlan.free) {
    return { ...saasPlan, planSource: "subscription" };
  }

  if (hasValidLicense) {
    return { ...licensePlan, planSource: "license" };
  }

  return { ...saasPlan, planSource: "free" };
}

function computeOverrideAddingLimitations(
  user?: PlanProviderUser,
): boolean {
  return !!user?.impersonator && isAdmin(user.impersonator);
}
