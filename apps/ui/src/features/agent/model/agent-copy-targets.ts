/**
 * Which projects an agent may be replicated into, and whether the reader may.
 *
 * `platform/app/src/hooks/useProjectsForCopy.ts` answered this by importing
 * `~/server/api/rbac` into a browser hook — `hasPermissionWithHierarchy` for a
 * custom role's own permission list, `teamRoleHasPermission` for the built-in
 * team roles. `apps/ui` may not reach `~/server`, and it does not have to:
 * `@langwatch/authz-contract` publishes both answers, and the roles module says
 * in its own docblock that they are parity-tested against the rbac pair this
 * replaces.
 *
 * THE PERMISSION IS PER TEAM, NOT PER PAGE, which is why the session
 * capability's `hasPermission` is the wrong question here: it answers for the
 * scope the reader is standing in, and this list offers every project in every
 * organization they belong to. A team the reader holds no membership row in
 * contributes no projects at all — the same shape the platform hook had, where a
 * missing member row returned an empty list for that team rather than a set of
 * greyed rows.
 *
 * A project the reader may NOT create in is still listed, greyed, because being
 * told the target exists and is closed to you is more use than a short list with
 * no explanation. That is the platform dialog's behaviour, carried over.
 */

import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The grant a replication target is judged by. Agents live under evaluations. */
export const AGENT_COPY_PERMISSION = "evaluations:manage";

/** The organization graph, narrowed to what this decision reads. */
export type AgentCopyOrganization = {
  name: string;
  teams: readonly AgentCopyTeam[];
};

export type AgentCopyTeam = {
  name: string;
  members?: readonly AgentCopyTeamMember[];
  projects: readonly { id: string; name: string }[];
};

export type AgentCopyTeamMember = {
  userId: string;
  role: string;
  assignedRole?: { permissions?: unknown } | null;
};

export type AgentCopyTargetRow = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

const TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);

/**
 * A custom role's own permission list, when it has a non-empty one.
 *
 * The column is JSON, so a row that has never been edited arrives as `null` and
 * a legacy row can arrive as anything. Only an array of strings is a permission
 * list; everything else falls through to the built-in role, which is what the
 * platform hook did when `permissions.length === 0`.
 */
function assignedPermissions(member: AgentCopyTeamMember): readonly string[] | undefined {
  const permissions = member.assignedRole?.permissions;
  if (!Array.isArray(permissions)) return void 0;
  const named = permissions.filter((entry): entry is string => typeof entry === "string");
  return named.length > 0 ? named : void 0;
}

function memberGrants(member: AgentCopyTeamMember, permission: string): boolean {
  const assigned = assignedPermissions(member);
  if (assigned) {
    return permissionSatisfiedBy({ granted: new Set(assigned), requested: permission });
  }
  // An unrecognised legacy role reads as the most restrictive built-in one
  // rather than as an error: the picker greys the row instead of vanishing it.
  const role = TEAM_ROLES.has(member.role) ? member.role : "VIEWER";
  return builtinRoleGrants({
    role: roleKeyForTeamRole(role as "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM"),
    permission,
  });
}

export function agentCopyTargets({
  organizations,
  userId,
  permission = AGENT_COPY_PERMISSION,
}: {
  organizations: readonly AgentCopyOrganization[];
  userId: string | undefined;
  permission?: string;
}): AgentCopyTargetRow[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      const member = team.members?.find((candidate) => candidate.userId === userId);
      if (!member) return [];

      const hasCreatePermission = memberGrants(member, permission);
      return team.projects.map((project) => ({
        label: `${organization.name} / ${team.name} / ${project.name}`,
        value: project.id,
        hasCreatePermission,
      }));
    }),
  );
}
