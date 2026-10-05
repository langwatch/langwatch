import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";

import {
  holdsSharedAccess,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
} from "./member-role-constraints.rules.ts";

/**
 * The team memberships an accepted invitation grants. Pure, so the correction is testable
 * in isolation. A Developer seat (ADR-171) grants no team at all, whatever the stored
 * invitation promised.
 */
export function resolveInviteTeamMemberships({
  role,
  teamIds,
  teamAssignments,
}: {
  role: OrganizationUserRole;
  teamIds: string;
  teamAssignments: unknown;
}): { teamId: string; role: TeamUserRole; customRoleId?: string }[] {
  if (!holdsSharedAccess(role)) return [];

  let memberships: {
    teamId: string;
    role: TeamUserRole;
    customRoleId?: string;
  }[];

  if (teamAssignments && Array.isArray(teamAssignments)) {
    const assignments: {
      teamId: string;
      role: TeamUserRole;
      customRoleId?: string;
    }[] = teamAssignments;
    memberships = assignments.map((a) => ({
      teamId: a.teamId,
      role: a.role,
      customRoleId: a.customRoleId,
    }));
  } else {
    const dedupedTeamIds = Array.from(
      new Set(
        teamIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    memberships = dedupedTeamIds.map((teamId) => ({
      teamId,
      role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
    }));
  }

  if (role !== OrganizationUserRole.EXTERNAL) {
    return memberships;
  }

  return memberships.map((membership) =>
    membership.role === TeamUserRole.VIEWER && !membership.customRoleId
      ? membership
      : {
          teamId: membership.teamId,
          role: TeamUserRole.VIEWER,
          customRoleId: undefined,
        },
  );
}

type InviteSeat = "FullMember" | "LiteMember" | "Developer";

/**
 * The seat one invite lands on: an EXTERNAL invite carrying a custom team role
 * with more than view permissions is a Full seat, since that is what the
 * licence counts it as once accepted. A Developer is counted, never capped.
 */
function inviteSeat({
  invite,
  customRoleMap,
  isViewOnlyCustomRole,
}: {
  invite: { role: OrganizationUserRole; teams?: { customRoleId?: string }[] };
  customRoleMap: Map<string, string[]>;
  isViewOnlyCustomRole: (permissions: string[]) => boolean;
}): InviteSeat {
  if (invite.role === OrganizationUserRole.ADMIN || invite.role === OrganizationUserRole.MEMBER) {
    return "FullMember";
  }
  if (invite.role === OrganizationUserRole.DEVELOPER) return "Developer";
  const hasNonViewRole = invite.teams?.some((team) => {
    if (!team.customRoleId) return false;
    const permissions = customRoleMap.get(team.customRoleId);
    return permissions && !isViewOnlyCustomRole(permissions);
  });
  return hasNonViewRole ? "FullMember" : "LiteMember";
}

/**
 * @param invites - Array of invites with role and optional team assignments
 * @param customRoleMap - Map of custom role ID to permissions array
 * @returns Count of full members, lite members and developers
 */
export function classifyInvitesByMemberType({
  invites,
  customRoleMap,
  isViewOnlyCustomRole,
}: {
  invites: {
    role: OrganizationUserRole;
    teams?: { customRoleId?: string }[];
  }[];
  customRoleMap: Map<string, string[]>;
  /**
   * The lite-seat rule, from whichever vertical owns it. Passed rather than imported: it is
   * the entitlement feature's answer, and a core package reaching into that one for a
   * predicate is how two counts of the same organization start disagreeing.
   */
  isViewOnlyCustomRole: (permissions: string[]) => boolean;
}): { fullMembers: number; liteMembers: number; developers: number } {
  const counts = { fullMembers: 0, liteMembers: 0, developers: 0 };
  for (const invite of invites) {
    const seat = inviteSeat({ invite, customRoleMap, isViewOnlyCustomRole });
    if (seat === "FullMember") counts.fullMembers++;
    else if (seat === "Developer") counts.developers++;
    else counts.liteMembers++;
  }
  return counts;
}
