/**
 * Which projects a prompt may be replicated into.
 */

import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The grant a replication target is judged by. */
export const PROMPT_COPY_PERMISSION = "prompts:create";

/** The organization graph, narrowed to what this decision reads. */
export type PromptCopyOrganization = {
  name: string;
  teams: readonly PromptCopyTeam[];
};

export type PromptCopyTeam = {
  name: string;
  members?: readonly PromptCopyTeamMember[];
  projects: readonly { id: string; name: string; slug: string }[];
};

export type PromptCopyTeamMember = {
  userId: string;
  role: string;
  assignedRole?: { permissions?: unknown } | null;
};

export type PromptCopyTargetRow = {
  id: string;
  name: string;
  slug: string;
  teamName: string;
};

const TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);

/**
 * A custom role's own permission list, when it has a non-empty one.
 */
function assignedPermissions(member: PromptCopyTeamMember): readonly string[] | undefined {
  const permissions = member.assignedRole?.permissions;
  if (!Array.isArray(permissions)) return void 0;
  const named = permissions.filter((entry): entry is string => typeof entry === "string");
  return named.length > 0 ? named : void 0;
}

function memberGrants(member: PromptCopyTeamMember, permission: string): boolean {
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

export function promptCopyTargets({
  organizations,
  userId,
  permission = PROMPT_COPY_PERMISSION,
}: {
  organizations: readonly PromptCopyOrganization[];
  userId: string | undefined;
  permission?: string;
}): PromptCopyTargetRow[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      const member = team.members?.find((candidate) => candidate.userId === userId);
      if (!member) return [];
      if (!memberGrants(member, permission)) return [];

      return team.projects.map((project) => ({
        id: project.id,
        name: `${organization.name} / ${team.name} / ${project.name}`,
        slug: project.slug,
        teamName: team.name,
      }));
    }),
  );
}
