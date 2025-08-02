import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

import { api } from "~/utils/api";

export const usePromptReferenceIdCheck = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useContext();

  const checkReferenceIdUniqueness = async (params: {
    referenceId: string;
    excludeId?: string;
  }) => {
    const isValid = await trpc.llmConfigs.checkReferenceIdUniqueness.fetch({
      ...params,
      projectId: project?.id ?? "",
    });

    return isValid;
  };

  return {
    checkReferenceIdUniqueness,
  };
};
