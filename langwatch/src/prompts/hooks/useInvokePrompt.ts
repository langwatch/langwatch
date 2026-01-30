import { type MutationOptions, useMutation } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { createLogger } from "~/utils/logger.client";
import { invokeLLM, type PromptExecutionResult } from "../utils/invokeLLM";

const logger = createLogger("useInvokePrompt");

/**
 * Options for the useInvokePrompt hook
 */
export interface InvokeParams {
  projectId: string;
  data: Node<LlmPromptConfigComponent>["data"];
}

/**
 * Hook for executing a prompt using TanStack Query
 *
 * This hook wraps the invokeLLM utility function in a mutation,
 * providing loading states, error handling, and cache management.
 */
export function useInvokePrompt(
  options?: Pick<MutationOptions, "mutationKey">,
) {
  return useMutation<PromptExecutionResult, Error, InvokeParams>({
    ...options,
    mutationFn: async ({ projectId, data }: InvokeParams) => {
      return invokeLLM({ projectId, data });
    },
    onError: (error) => {
      logger.error({ error }, "Error in prompt execution");
    },
  });
}
