import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";

/**
 * The project the open drawer reads from.
 */
export function useDrawerProjectId(): string {
  const { project } = useOrganizationTeamProject();
  const openedProjectId = useTraceDrawer((s) => s.projectId);
  return openedProjectId ?? project?.id ?? "";
}
