import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import type { PromptScope } from "@langwatch/workflow-contract";

import { promptApi } from "../prompt-api.ts";

export const usePromptHandleCheck = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = promptApi.useUtils();

  const checkHandleUniqueness = async (params: { handle: string; scope: PromptScope }) => {
    const isValid = await trpc.prompts.checkHandleUniqueness.fetch({
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
