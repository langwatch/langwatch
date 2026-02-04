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
