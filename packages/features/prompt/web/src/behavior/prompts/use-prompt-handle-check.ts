import type { PromptScope } from "@langwatch/workflow-web/model/prisma-types";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";

export const usePromptHandleCheck = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useUtils();

  const checkHandleUniqueness = async (params: {
    handle: string;
    scope: PromptScope;
  }) => {
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
