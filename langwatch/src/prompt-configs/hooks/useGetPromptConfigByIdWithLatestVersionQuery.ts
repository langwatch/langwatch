import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export const useGetPromptConfigByIdWithLatestVersionQuery = (
  configId: string
) => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  return api.llmConfigs.getByIdWithLatestVersion.useQuery(
    { id: configId, projectId },
    { enabled: !!configId && !!projectId }
  );
};
