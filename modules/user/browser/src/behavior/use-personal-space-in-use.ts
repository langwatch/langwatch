import { api } from "./personal-workspace-api.ts";
import { useCurrentUser, useOrganizationTeamProject } from "./personal-workspace-session.ts";

/**
 * Whether the personal home has a personal key or any usage this month, answered by the page's
 * own reads through the query cache. Null while unknown (loading, failed), which keeps the
 * guided offer hidden.
 * @see specs/home/guided-onboarding-offer.feature
 */
export function usePersonalSpaceInUse(): boolean | null {
  const currentUser = useCurrentUser();
  const { organization } = useOrganizationTeamProject();
  const orgId = organization?.id ?? "org_unknown";
  const userId = currentUser?.id;

  const keys = api.personalVirtualKeys.list.useQuery(
    { organizationId: orgId, targetUserId: userId ?? "" },
    { enabled: !!organization && !!userId, refetchOnWindowFocus: false },
  );
  const usage = api.user.personalUsage.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  if (keys.isError || !keys.data) return null;
  if (keys.data.length > 0) return true;
  if (usage.isError || !usage.data) return null;
  return usage.data.summary.requests > 0;
}
