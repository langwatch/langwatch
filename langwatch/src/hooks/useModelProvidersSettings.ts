import type { ModelMetadataForFrontend } from "../server/api/routers/modelProviders";
import { api } from "../utils/api";

export type { ModelMetadataForFrontend };

export function useModelProvidersSettings(params: {
  projectId: string | undefined;
}) {
  const projectId = params.projectId ?? "";

  const modelProviders = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );

  return {
    /** Model providers configuration (enabled/disabled, custom keys, etc.) */
    providers: modelProviders.data?.providers,
    /** Metadata for all available models (supportedParameters, contextLength, etc.) */
    modelMetadata: modelProviders.data?.modelMetadata,
    isLoading: modelProviders.isLoading,
    refetch: modelProviders.refetch,
  } as const;
}

/**
 * Hook to get metadata for a specific model
 */
export function useModelMetadata(params: {
  projectId: string | undefined;
  modelId: string | undefined;
}) {
  const { modelMetadata, isLoading } = useModelProvidersSettings({
    projectId: params.projectId,
  });

  const metadata = params.modelId ? modelMetadata?.[params.modelId] : undefined;

  return {
    metadata,
    isLoading,
  } as const;
}
