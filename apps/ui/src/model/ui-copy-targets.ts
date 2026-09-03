/**
 * Which projects a thing may be replicated into, via
 * `@langwatch/authz-contract` (apps/ui may not reach `~/server`). PER
 * TEAM, not per page. A closed project stays listed, `canCreate: false`.
 */

import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The organization graph, narrowed to what this decision reads. */
export type UiCopyOrganization = {
  name: string;
  teams: readonly UiCopyTeam[];
};

export type UiCopyTeam = {
  name: string;
  members?: readonly UiCopyTeamMember[];
  projects: readonly { id: string; name: string }[];
};

export type UiCopyTeamMember = {
  userId: string;
  role: string;
  assignedRole?: { permissions?: unknown } | null;
};

export type UiCopyTargetRow = {
  id: string;
  /** "Organization / Team / Project", as both replication selects render it. */
  name: string;
  canCreate: boolean;
};

const TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);

/**
 * A custom role's own permission list, when non-empty — the column is
 * JSON, so only an array of strings counts; anything else (including a
 * never-edited `null`) falls through to the built-in role.
 */
function assignedPermissions(member: UiCopyTeamMember): readonly string[] | undefined {
  const permissions = member.assignedRole?.permissions;
  if (!Array.isArray(permissions)) return void 0;
  const named = permissions.filter((entry): entry is string => typeof entry === "string");
  return named.length > 0 ? named : void 0;
}

function memberGrants(member: UiCopyTeamMember, permission: string): boolean {
  const assigned = assignedPermissions(member);
  if (assigned) {
    return permissionSatisfiedBy({ granted: new Set(assigned), requested: permission });
  }
  // An unrecognised legacy role reads as the most restrictive built-in one
  // rather than as an error: the row is offered as closed instead of offered as
  // a target the server would then refuse.
  const role = TEAM_ROLES.has(member.role) ? member.role : "VIEWER";
  return builtinRoleGrants({
    role: roleKeyForTeamRole(role as "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM"),
    permission,
  });
}

export function uiCopyTargets({
  organizations,
  userId,
  permission,
}: {
  organizations: readonly UiCopyOrganization[];
  userId: string | undefined;
  permission: string;
}): UiCopyTargetRow[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      const member = team.members?.find((candidate) => candidate.userId === userId);
      if (!member) return [];
      const canCreate = memberGrants(member, permission);

      return team.projects.map((project) => ({
        id: project.id,
        name: `${organization.name} / ${team.name} / ${project.name}`,
        canCreate,
      }));
    }),
  );
}
