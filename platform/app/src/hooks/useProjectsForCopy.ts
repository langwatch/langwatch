import { useMemo } from "react";
import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
} from "~/server/api/rbac";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";

export type CopyTargetProject = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

/**
 * Permission used to filter which projects appear as copy targets.
 * - evaluations:manage: agents, evaluators
 * - prompts:create: prompts
 * - workflows:create: workflows
 */
export type CopyTargetPermission =
  | "evaluations:manage"
  | "prompts:create"
  | "workflows:create";

/**
 * Returns a memoized list of projects the current user can copy to,
 * with permission flags for the given permission (default: evaluations:manage).
 */
export function useProjectsForCopy(
  permission: CopyTargetPermission = "evaluations:manage",
): CopyTargetProject[] {
  const { organizations } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const currentUserId = session.data?.user?.id;

  return useMemo(() => {
    if (!organizations) return [];

    return organizations.flatMap((org) =>
      org.teams.flatMap((team) => {
        const teamMember = team.members.find(
          (member) => member.userId === currentUserId,
        );
        if (!teamMember) return [];

        let hasPermission = false;
        if (teamMember.assignedRole) {
          const permissions =
            (teamMember.assignedRole.permissions as string[]) ?? [];
          if (permissions.length > 0) {
            hasPermission = hasPermissionWithHierarchy(
              permissions,
              permission,
            );
          } else {
            hasPermission = teamRoleHasPermission(
              teamMember.role,
              permission,
            );
          }
        } else {
          hasPermission = teamRoleHasPermission(teamMember.role, permission);
        }

        return team.projects.map((proj) => ({
          label: `${org.name} / ${team.name} / ${proj.name}`,
          value: proj.id,
          hasCreatePermission: hasPermission,
        }));
      }),
    );
  }, [organizations, currentUserId, permission]);
}
