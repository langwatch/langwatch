import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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
