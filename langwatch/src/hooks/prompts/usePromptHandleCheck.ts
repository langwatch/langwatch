import { type PromptScope } from "@prisma/client";

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

import { api } from "~/utils/api";

export const usePromptHandleCheck = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useContext();

  const checkHandleUniqueness = async (params: {
    handle: string;
    scope: PromptScope;
  }) => {
    const isValid = await trpc.llmConfigs.checkHandleUniqueness.fetch({
      projectId: project?.id ?? "",
      scope: params.scope,
      handle: params.handle,
    });

    return isValid;
  };

  return {
    checkHandleUniqueness,
  };
};
