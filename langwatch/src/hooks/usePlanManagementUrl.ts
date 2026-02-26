import { PricingModel } from "@prisma/client";
import { usePublicEnv } from "./usePublicEnv";

/**
 * Returns the appropriate URL for plan management based on deployment type.
 * - SaaS mode (IS_SAAS=true): "/settings/subscription"
 * - Self-hosted mode (IS_SAAS=false): "/settings/license"
 *
 * Also provides the appropriate button label:
 * - SaaS mode: "Upgrade plan"
 * - Self-hosted mode: "Upgrade license"
 */
export function usePlanManagementUrl() {
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS ?? false;

  return {
    url: isSaaS ? "/settings/subscription" : "/settings/license",
    buttonLabel: isSaaS ? "Upgrade plan" : "Upgrade license",
    isSaaS,
    isLoading: publicEnv.isLoading,
  };
}

/**
 * Returns the plan management URL synchronously.
 * Use this for cases where you need the URL outside of a React component.
 */
export function getPlanManagementUrl(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}

/**
 * Returns the plan management button label synchronously.
 * Use this for cases where you need the label outside of a React component.
 */
export function getPlanManagementButtonLabel(isSaaS: boolean): string {
  return isSaaS ? "Upgrade plan" : "Upgrade license";
}

/**
 * Determines whether the usage page should display "current / max" limit
 * format for each resource.
 *
 * Free plans: always show limits
 * Enterprise: never show limits
 * Paid + TIERED: show limits (plan has hard caps)
 * Paid + SEAT_EVENT: hide limits (usage-based billing)
 * No pricing model (legacy): show limits (safe default)
 */
export function shouldShowPlanLimits({
  isFree,
  isEnterprise,
  pricingModel,
}: {
  isFree: boolean;
  isEnterprise: boolean;
  pricingModel: PricingModel | undefined | null;
}): boolean {
  if (isEnterprise) return false;
  if (isFree) return true;
  return pricingModel !== PricingModel.SEAT_EVENT;
}

/**
 * Returns a context-aware label for plan management actions on the usage page.
 * Unlike `getPlanManagementButtonLabel` which always says "Upgrade", this
 * reflects the user's current billing state (e.g. "Manage Subscription" for
 * paid users).
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
