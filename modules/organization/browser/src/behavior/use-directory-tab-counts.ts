/**
 * The numbers the Directory's closed tabs carry, read here because a number on
 * a closed tab is the reason somebody opens it. One count-only read answers
 * them all, so no tab's list loads until that tab opens.
 */
import { peopleTabCount } from "../model/directory-tabs.ts";
import { api } from "./organization-api.ts";

export function useDirectoryTabCounts({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  const counts = api.organization.getDirectoryCounts.useQuery(
    { organizationId },
    { enabled: enabled && !!organizationId },
  );

  return {
    people: peopleTabCount({
      memberCount: counts.data?.members,
      openInviteCount: counts.data?.openInvites,
      requestCount: counts.data?.joinRequests,
    }),
    teams: counts.data?.teams,
    groups: counts.data?.groups,
  };
}
