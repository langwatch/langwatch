import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api } from "../../behavior/scenario-api";

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
      // The prompt catalog is regularly the slowest query on a screen, and
      // in a batched request every sibling call waits for the slowest
      // member. This one travels alone so it cannot hold anything else up.
      trpc: { context: { skipBatch: true } },
    },
  );
}
