import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import type { PromptScope } from "@langwatch/workflow-contract";

export const usePromptHandleCheck = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useUtils();

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
