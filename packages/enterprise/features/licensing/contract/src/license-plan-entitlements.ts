// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PlanInfo } from "./license-plan";

/**
 * The entitlements a plan tier carries, applied wherever a plan is resolved.
 *
 * An entitlement that belongs to a tier is decided from the tier, not copied
 * into every contract. A flag written after a contract was signed still
 * reaches that contract, because nothing about the tier changed when the flag
 * was written, and neither leg of resolution has to be re-run: a signed
 * license minted years ago and a subscription row created this morning both
 * arrive on enterprise and both come out entitled.
 *
 * Only fields the plan leaves `undefined` are filled. An explicit value is a
 * decision and always wins, including an explicit `false`: a contract that
 * withholds a tier feature has to keep withholding it.
 *
 * WHAT BELONGS IN THIS MAP: entitlement, meaning what the plan grants. What
 * does NOT belong: authorization, meaning what a particular reader may do.
 * `PlanInfo` carries exactly two optional booleans and they sit on opposite
 * sides of that line. `webhookEndpointsEnabled` is entitlement and is mapped
 * here. `overrideAddingLimitations` is authorization: it says the reader is an
 * admin impersonating somebody, the composite provider recomputes it from the
 * impersonation context on every call, and the unlicensed baseline sets it
 * true. Deriving it from a tier would hand every enterprise reader the power
 * to bypass the limits their own plan sets. A future optional flag picks a
 * side here before it picks a default anywhere else.
 *
 * `floorAtOssBaseline` is a different rule and stays where it is: it is
 * self-hosted policy about what a license may not withdraw, applied on the
 * license leg only. This map is about what a tier grants, on every leg.
 */
type TierEntitlements = Partial<Pick<PlanInfo, "webhookEndpointsEnabled">>;

export const ENTITLEMENTS_BY_PLAN_TYPE: Partial<Record<string, TierEntitlements>> = {
  ENTERPRISE: { webhookEndpointsEnabled: true },
};

/**
 * Fills in the entitlements the plan's tier grants and it has not answered.
 *
 * Returns the plan itself when there is nothing to fill, so a resolved plan
 * keeps its identity through this step.
 */
export function applyPlanTypeEntitlements(plan: PlanInfo): PlanInfo {
  const entitlements = ENTITLEMENTS_BY_PLAN_TYPE[plan.type];
  if (!entitlements) return plan;

  let filled: PlanInfo | undefined;
  for (const field of Object.keys(entitlements) as Array<keyof TierEntitlements>) {
    if (plan[field] !== undefined) continue;
    filled ??= { ...plan };
    filled[field] = entitlements[field];
  }

  return filled ?? plan;
}
