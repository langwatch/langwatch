/**
 * Which projects a dataset may be replicated into.
 */

import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The grant a replication target is judged by. */
export const DATASET_COPY_PERMISSION = "datasets:create";

/** The organization graph, narrowed to what this decision reads. */
export type DatasetCopyOrganization = {
  name: string;
  teams: readonly DatasetCopyTeam[];
};

export type DatasetCopyTeam = {
  name: string;
  members?: readonly DatasetCopyTeamMember[];
  projects: readonly { id: string; name: string }[];
};

export type DatasetCopyTeamMember = {
  userId: string;
  role: string;
  assignedRole?: { permissions?: unknown } | null;
};

export type DatasetCopyTargetRow = {
  label: string;
  value: string;
};

const TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);

/**
 * A custom role's own permission list, when it has a non-empty one.
 */
function assignedPermissions(member: DatasetCopyTeamMember): readonly string[] | undefined {
  const permissions = member.assignedRole?.permissions;
  if (!Array.isArray(permissions)) return void 0;
  const named = permissions.filter((entry): entry is string => typeof entry === "string");
  return named.length > 0 ? named : void 0;
}

function memberGrants(member: DatasetCopyTeamMember, permission: string): boolean {
  const assigned = assignedPermissions(member);
  if (assigned) {
    return permissionSatisfiedBy({ granted: new Set(assigned), requested: permission });
  }
  // An unrecognised legacy role reads as the most restrictive built-in one
  // rather than as an error: the picker drops the row instead of offering a
  // target the server would then refuse.
  const role = TEAM_ROLES.has(member.role) ? member.role : "VIEWER";
  return builtinRoleGrants({
    role: roleKeyForTeamRole(role as "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM"),
    permission,
  });
}

export function datasetCopyTargets({
  organizations,
  userId,
  permission = DATASET_COPY_PERMISSION,
}: {
  organizations: readonly DatasetCopyOrganization[];
  userId: string | undefined;
  permission?: string;
}): DatasetCopyTargetRow[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      const member = team.members?.find((candidate) => candidate.userId === userId);
      if (!member) return [];
      if (!memberGrants(member, permission)) return [];

      return team.projects.map((project) => ({
        label: `${organization.name} / ${team.name} / ${project.name}`,
        value: project.id,
      }));
    }),
  );
}
