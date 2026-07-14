import {
  type CustomRole,
  OrganizationUserRole,
  type Team,
  TeamUserRole,
  type TeamUser,
} from "@prisma/client";
import {
  MISSING_CUSTOM_ROLE_VALUE,
  teamRolesOptions,
} from "../components/settings/TeamUserRoleField";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  type TeamRoleValue,
} from "./memberRoleConstraints";

export type PendingTeamRole = {
  role: TeamRoleValue;
  customRoleId?: string;
};

export type PendingTeamRoleMap = Record<string, PendingTeamRole>;

export type TeamRoleUpdatePayload = {
  teamId: string;
  userId: string;
  role: TeamRoleValue;
  customRoleId?: string;
};

export type TeamMembershipWithRole = TeamUser & {
  assignedRole?: CustomRole | null;
  team: Team;
};

/** Resolves the effective team role value for display/comparison, handling CUSTOM roles. */
export function resolveTeamRoleValue(
  membership: TeamMembershipWithRole,
): TeamRoleValue {
  if (membership.role === TeamUserRole.CUSTOM) {
    return membership.assignedRole
      ? `custom:${membership.assignedRole.id}`
      : MISSING_CUSTOM_ROLE_VALUE;
  }
  return membership.role;
}

/** Returns a human-readable display name for a team membership's role. */
export function getTeamRoleDisplayName(
  membership: TeamMembershipWithRole,
): string {
  if (membership.role === "CUSTOM") {
    return membership.assignedRole?.name ?? "Custom";
  }
  const option =
    teamRolesOptions[membership.role as keyof typeof teamRolesOptions];
  return option?.label ?? membership.role;
}

/** Builds an initial map of pending team roles from server data, filtered by organization. */
export function buildInitialPendingTeamRoles(params: {
  teamMemberships: TeamMembershipWithRole[];
  organizationId?: string;
}): PendingTeamRoleMap {
  const { teamMemberships, organizationId } = params;
  return Object.fromEntries(
    teamMemberships
      .filter((tm) => tm.team.organizationId === organizationId)
      .map((tm) => [
        tm.teamId,
        {
          role: resolveTeamRoleValue(tm),
          customRoleId:
            tm.role === TeamUserRole.CUSTOM ? tm.assignedRole?.id : undefined,
        },
      ]),
  );
}

/** Computes the list of team role updates that differ from the current server state. */
export function getTeamRoleUpdates(params: {
  teamMemberships: TeamMembershipWithRole[];
  pendingTeamRoles: PendingTeamRoleMap;
  userId: string;
}): TeamRoleUpdatePayload[] {
  const { teamMemberships, pendingTeamRoles, userId } = params;

  return teamMemberships.flatMap((teamMembership) => {
    const pending = pendingTeamRoles[teamMembership.teamId];
    if (!pending) return [];

    const currentRole = resolveTeamRoleValue(teamMembership);
    const currentCustomRoleId =
      teamMembership.role === TeamUserRole.CUSTOM
        ? teamMembership.assignedRole?.id
        : undefined;

    if (
      pending.role === currentRole &&
      (pending.customRoleId ?? undefined) === currentCustomRoleId
    ) {
      return [];
    }

    return [
      {
        teamId: teamMembership.teamId,
        userId,
        role: pending.role,
        customRoleId: pending.customRoleId,
      },
    ];
  });
}

/** Checks whether there are any unsaved role changes (organization or team level). */
export function hasPendingRoleChanges(params: {
  teamMemberships: TeamMembershipWithRole[];
  pendingTeamRoles: PendingTeamRoleMap;
  pendingOrganizationRole: OrganizationUserRole | null;
  currentOrganizationRole: OrganizationUserRole;
}): boolean {
  const {
    teamMemberships,
    pendingTeamRoles,
    pendingOrganizationRole,
    currentOrganizationRole,
  } = params;

  if (
    pendingOrganizationRole !== null &&
    pendingOrganizationRole !== currentOrganizationRole
  ) {
    return true;
  }

  return teamMemberships.some((teamMembership) => {
    const pending = pendingTeamRoles[teamMembership.teamId];
    if (!pending) return false;

    const currentRole = resolveTeamRoleValue(teamMembership);

    return (
      pending.role !== currentRole ||
      (pending.customRoleId ?? null) !==
        (teamMembership.assignedRole?.id ?? null)
    );
  });
}

/** Performs a shallow equality check on two PendingTeamRoleMaps. */
export function arePendingTeamRolesEqual(
  left: PendingTeamRoleMap,
  right: PendingTeamRoleMap,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([teamId, leftRole]) => {
    const rightRole = right[teamId];
    if (!rightRole) return false;
    return (
      leftRole.role === rightRole.role &&
      (leftRole.customRoleId ?? null) === (rightRole.customRoleId ?? null)
    );
  });
}

/** Determines the license limit type that applies when changing between organization roles. */
export function getLicenseLimitTypeForRoleChange(params: {
  previousRole: OrganizationUserRole;
  nextRole: OrganizationUserRole;
}): "members" | "membersLite" | null {
  const { previousRole, nextRole } = params;

  if (
    previousRole === OrganizationUserRole.EXTERNAL &&
    nextRole !== OrganizationUserRole.EXTERNAL
  ) {
    return "members";
  }

  if (
    previousRole !== OrganizationUserRole.EXTERNAL &&
    nextRole === OrganizationUserRole.EXTERNAL
  ) {
    return "membersLite";
  }

  return null;
}

/** Applies organization role constraints to all pending team roles (e.g., forces Viewer for EXTERNAL). */
export function applyOrganizationRoleToPendingTeamRoles(params: {
  organizationRole: OrganizationUserRole;
  currentPendingTeamRoles: PendingTeamRoleMap;
}): PendingTeamRoleMap {
  const { organizationRole, currentPendingTeamRoles } = params;

  return Object.fromEntries(
    Object.entries(currentPendingTeamRoles).map(([teamId, teamRole]) => [
      teamId,
      {
        role: getAutoCorrectedTeamRoleForOrganizationRole({
          organizationRole,
          currentTeamRole: teamRole.role,
        }),
        customRoleId:
          organizationRole === OrganizationUserRole.EXTERNAL
            ? undefined
            : teamRole.customRoleId,
      },
    ]),
  );
}
