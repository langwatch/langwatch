import type { PromptScope } from "@langwatch/prompt-contract";
import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

export const usePromptHandleCheck = () => {
  const { project } = usePromptProject();
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
