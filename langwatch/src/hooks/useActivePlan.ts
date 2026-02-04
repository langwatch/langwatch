import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Hook to check active plan type for feature gating.
 *
 * @returns {object} Plan status
 * - `isEnterprise`: true if plan type is "ENTERPRISE"
 * - `isFree`: true if on free tier
 * - `isLoading`: true while fetching plan data
 * - `activePlan`: full plan object (or undefined if loading)
 */
export function useActivePlan() {
  const { organization } = useOrganizationTeamProject();

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization?.id },
  );

  return {
    isEnterprise: usage.data?.activePlan.type === "ENTERPRISE",
    isFree: usage.data?.activePlan.free ?? true,
    isLoading: usage.isLoading,
    activePlan: usage.data?.activePlan,
  };
}
