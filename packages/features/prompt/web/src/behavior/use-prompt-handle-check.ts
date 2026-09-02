import type { PromptScope } from "@langwatch/prompt-contract";
import { promptApi } from "./prompt-api";
import { usePromptProject } from "./use-prompt-project";

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
