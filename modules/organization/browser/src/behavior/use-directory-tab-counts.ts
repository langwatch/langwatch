/**
 * The numbers the Directory's closed tabs carry, read here because a number on
 * a closed tab is the reason somebody opens it. The reads are the ones each
 * tab runs itself, so one request answers both and the two never disagree.
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
  const reading = { enabled: enabled && !!organizationId };
  const groups = api.group.listAll.useQuery({ organizationId }, reading);
  const teams = api.team.getTeamsWithRoleBindings.useQuery({ organizationId }, reading);
  const members = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: true },
    reading,
  );
  const invites = api.invite.getOrganizationPendingInvites.useQuery({ organizationId }, reading);
  const waiting = api.joinRequests.pending.useQuery({ organizationId }, reading);

  return {
    people: peopleTabCount({
      memberCount: members.data?.members.length,
      openInviteCount: invites.data?.filter(
        (invite) => invite.displayStatus === "PENDING" || invite.displayStatus === "EXPIRED",
      ).length,
      requestCount: waiting.data?.length,
    }),
    teams: teams.data?.length,
    groups: groups.data?.length,
  };
}
