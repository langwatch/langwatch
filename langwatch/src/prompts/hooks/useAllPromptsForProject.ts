import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * useAllPromptsForProject
 * Single Responsibility: Fetch all prompts for the current project.
 * @returns Query result containing prompts for the project
 */
export function useAllPromptsForProject() {
  const { projectId = "" } = useOrganizationTeamProject();
  return api.prompts.getAllPromptsForProject.useQuery(
    {
      projectId: projectId,
    },
    {
      enabled: !!projectId,
    },
  );
}
