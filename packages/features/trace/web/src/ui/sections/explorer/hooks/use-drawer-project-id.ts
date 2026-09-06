import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useDrawerStore } from "../../../../behavior/drawer.store.ts";

/**
 * The project the open drawer reads from.
 */
export function useDrawerProjectId(): string {
  const { project } = useOrganizationTeamProject();
  const openedProjectId = useDrawerStore((s) => s.projectId);
  return openedProjectId ?? project?.id ?? "";
}
