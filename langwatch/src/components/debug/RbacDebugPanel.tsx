import { useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Exposes window.__lw_debug so the LangWatch RBAC Chrome extension can read
 * the current org/team/project context and call the debug API.
 * Renders nothing — zero UI impact.
 */
export function DebugContextExposer() {
  const { organization, team, project } = useOrganizationTeamProject();

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>)["__lw_debug"] = {
        orgId: organization?.id ?? null,
        teamId: team?.id ?? null,
        projectId: project?.id ?? null,
      };
    }
  }, [organization?.id, team?.id, project?.id]);

  return null;
}
