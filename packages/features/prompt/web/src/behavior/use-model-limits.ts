import { promptApi } from "./prompt-api";
import { usePromptProject } from "./use-prompt-project";

export interface UseModelLimitsParams {
  model: string | undefined;
}

/**
 * Hook to get model limits for a given model
 *
 * @param params - Parameters containing the model name
 * @returns Object with model limits data, loading state, and error state
 */
export function useModelLimits(params: UseModelLimitsParams) {
  const { projectId } = usePromptProject();
  const { model } = params;

  const query = promptApi.llmModelCost.getModelLimits.useQuery(
    { model: model ?? "", projectId: projectId ?? "" },
    { enabled: Boolean(model) },
  );

  return {
    limits: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  } as const;
}
