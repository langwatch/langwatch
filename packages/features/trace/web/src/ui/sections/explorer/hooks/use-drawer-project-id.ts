import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { useDrawerStore } from "../../../../index";

/**
 * The project the open drawer reads from.
 *
 * Everywhere the drawer opens over a project's own pages this is the ambient
 * project, and nothing has to say so. The personal pages (`/me/…`) are the
 * exception: they read the caller's own workspace while the chrome stays in
 * whichever project was last visited, so the opener names the project and
 * every read inside the drawer follows the trace rather than the chrome.
 *
 * Openers that name nothing leave the store slot null, so the ambient project
 * keeps deciding and no existing surface changes.
 */
export function useDrawerProjectId(): string {
  const { project } = useOrganizationTeamProject();
  const openedProjectId = useDrawerStore((s) => s.projectId);
  return openedProjectId ?? project?.id ?? "";
}
