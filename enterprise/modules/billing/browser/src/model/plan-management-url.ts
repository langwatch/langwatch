/**
 * Where upgrade goes; local copy of hook, pure half only (inputs as args).
 */

import { UPGRADE_DIALOG_HREF } from "./checkout-intent.ts";
import { PricingModel } from "./prisma-types.ts";

/**
 * SaaS goes to the subscription page, self-hosted to the license page. One
 * deployment fact, two addresses, and no third case.
 */
export function planManagementUrl(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}

/** Where the usage page's plan action goes: a Free cloud plan opens the Growth seat dialog. */
export function planActionHref({
  isSaaS,
  isFree,
  isEnterprise,
}: {
  isSaaS: boolean;
  isFree: boolean;
  isEnterprise: boolean;
}): string {
  if (isSaaS && isFree && !isEnterprise) return UPGRADE_DIALOG_HREF;
  return planManagementUrl(isSaaS);
}

/**
 * Whether to show "current / max" for each resource. Depends on whether the plan has
 * meaningful caps: Free/License/TIERED show them, Enterprise/SEAT_EVENT don't, legacy default.
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
 * What the plan action on the usage page is called. Unlike a fixed
 * "Upgrade", this reflects the billing state the reader is in — someone
 * already paying is MANAGING a subscription, not upgrading one.
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
    return hasValidLicense ? "Manage license" : "Upgrade license";
  }
  if (isEnterprise) return "Manage subscription";
  if (isFree) return "Upgrade plan";
  return "Manage subscription";
}
