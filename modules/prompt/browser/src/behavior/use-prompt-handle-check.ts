import { promptClient } from "@langwatch/prompt-client";
import type { PromptScope } from "@langwatch/prompt-contract";

import { usePromptProject } from "./use-prompt-project.ts";

export const usePromptHandleCheck = () => {
  const { project } = usePromptProject();
  const trpc = promptClient.useUtils();

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
