/**
 * Where "upgrade" goes, and what the button says when it gets there.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/hooks/usePlanManagementUrl.ts`,
 * which stays: the command bar, the upgrade modal, `@langwatch/langy-web` and
 * `@langwatch/navigation-web` all still read it, and the deletes-only ruling
 * forbids repointing one of them. What travels is the PURE half — every
 * function below takes its inputs as arguments — because the hook half read
 * `usePublicEnv`, which is a round trip this package answers off its host port
 * instead.
 */

import { PricingModel } from "./prisma-types";

/**
 * SaaS goes to the subscription page, self-hosted to the license page. One
 * deployment fact, two addresses, and no third case.
 */
export function planManagementUrl(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}

/**
 * Whether the usage page shows "current / max" for each resource.
 *
 * Free plans always show limits; Enterprise never does; a license always does,
 * because a license IS a hard cap; and beyond that it turns on the pricing
 * model — TIERED has caps to show and SEAT_EVENT bills by usage, so a ceiling
 * would be a fiction. No pricing model at all is a legacy organization, and
 * showing the limits is the safe default there.
 */
export function shouldShowPlanLimits({
  isFree,
  isEnterprise,
  pricingModel,
  planSource,
}: {
  isFree: boolean;
  isEnterprise: boolean;
  pricingModel: PricingModel | undefined | null;
  planSource?: "license" | "subscription" | "free";
}): boolean {
  if (isEnterprise) return false;
  if (planSource === "license") return true;
  if (isFree) return true;
  return pricingModel !== PricingModel.SEAT_EVENT;
}

/**
 * What the plan action on the usage page is called.
 *
 * Unlike a fixed "Upgrade", this reflects the billing state the reader is
 * actually in: somebody already paying is MANAGING a subscription, not
 * upgrading one, and telling them otherwise reads as a page that has not
 * noticed they bought it.
 */
export function getPlanActionLabel({
  isSaaS,
  isFree,
  isEnterprise,
  hasValidLicense,
}: {
  isSaaS: boolean;
  isFree: boolean;
  isEnterprise: boolean;
  hasValidLicense: boolean;
}): string {
  if (!isSaaS) {
    return hasValidLicense ? "Manage License" : "Upgrade License";
  }
  if (isEnterprise) return "Manage Subscription";
  if (isFree) return "Upgrade Plan";
  return "Manage Subscription";
}
