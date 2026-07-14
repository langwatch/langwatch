import type { PromptScope } from "@prisma/client";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

export const usePromptHandleCheck = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useContext();

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
