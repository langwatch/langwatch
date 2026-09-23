import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";

import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "./member-role-constraints.rules.ts";

/**
 * The team memberships an accepted invitation grants. Pure, like
 * `classifyInvitesByMemberType`, so the correction is testable in isolation.
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

/**
 * @param invites - Array of invites with role and optional team assignments
 * @param customRoleMap - Map of custom role ID to permissions array
 * @returns Count of full members and lite members
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
}): { fullMembers: number; liteMembers: number } {
  let fullMembers = 0;
  let liteMembers = 0;

  for (const invite of invites) {
    if (invite.role === OrganizationUserRole.ADMIN || invite.role === OrganizationUserRole.MEMBER) {
      fullMembers++;
    } else if (invite.role === OrganizationUserRole.EXTERNAL) {
      const hasNonViewRole = invite.teams?.some((t) => {
        if (!t.customRoleId) {
          return false;
        }

        const permissions = customRoleMap.get(t.customRoleId);

        return permissions && !isViewOnlyCustomRole(permissions);
      });
      if (hasNonViewRole) {
        fullMembers++;
      } else {
        liteMembers++;
      }
    }
  }

  return { fullMembers, liteMembers };
}
