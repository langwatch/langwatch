import { useMutation, type MutationOptions } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";

import { invokeLLM, type PromptExecutionResult } from "../utils/invokeLLM";

import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useInvokePrompt");

/**
 * Hook for executing a prompt using TanStack Query
 *
 * This hook wraps the invokeLLM utility function in a mutation,
 * providing loading states, error handling, and cache management.
 */
export function useInvokePrompt(
  options?: Pick<MutationOptions, "mutationKey">
) {
  return useMutation<
    PromptExecutionResult,
    Error,
    {
      projectId: string;
      data: Node<LlmPromptConfigComponent>["data"];
    }
  >({
    ...options,
    mutationFn: async ({
      projectId,
      data,
    }: {
      projectId: string;
      data: Node<LlmPromptConfigComponent>["data"];
    }) => {
      return invokeLLM({ projectId, data });
    },
    onError: (error) => {
      logger.error({ error }, "Error in prompt execution");
    },
  });
}
