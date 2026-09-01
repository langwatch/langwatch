/**
 * Which projects a dataset may be replicated into.
 *
 * `platform/app/src/components/datasets/CopyDatasetDialog` answered this by
 * importing `~/server/api/rbac` into a browser component —
 * `hasPermissionWithHierarchy` for a custom role's own permission list,
 * `teamRoleHasPermission` for the built-in team roles. `apps/ui` may not reach
 * `~/server`, and it does not have to: `@langwatch/authz-contract` publishes
 * both answers, and its roles module says in its own docblock that they are
 * parity-tested against the rbac pair this replaces. The Agents family made the
 * same move for its own replication picker.
 *
 * THE PERMISSION IS PER TEAM, NOT PER PAGE, which is why the session
 * capability's `hasPermission` is the wrong question here: it answers for the
 * scope the reader is standing in, and this list offers every project in every
 * organization they belong to.
 *
 * A project the reader may NOT create a dataset in is LEFT OUT, rather than
 * listed and greyed. That is the platform dialog's behaviour and it differs from
 * the Agents picker's on purpose: this list is a plain select with no room for a
 * disabled row's explanation, so an unreachable target would read as a target.
 * A team the reader holds no membership row in contributes no projects at all.
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
 *
 * The column is JSON, so a row that has never been edited arrives as `null` and
 * a legacy row can arrive as anything. Only an array of strings is a permission
 * list; everything else falls through to the built-in role, which is what the
 * platform dialog did when `permissions.length === 0`.
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
