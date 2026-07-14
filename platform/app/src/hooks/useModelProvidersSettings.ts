import { useMemo } from "react";
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

  const providers = modelProviders.data?.providers;
  const isLoading = modelProviders.isLoading;

  const hasEnabledProviders = useMemo(() => {
    // Default to true while loading or if providers data is not yet available
    // This prevents false positive warnings during initial load
    if (isLoading || !providers) return true;

    return Object.values(providers).some(
      (provider) =>
        typeof provider === "object" &&
        provider !== null &&
        "enabled" in provider &&
        provider.enabled
    );
  }, [providers, isLoading]);

  return {
    /** Model providers configuration (enabled/disabled, custom keys, etc.) */
    providers,
    /** Metadata for all available models (supportedParameters, contextLength, etc.) */
    modelMetadata: modelProviders.data?.modelMetadata,
    isLoading,
    refetch: modelProviders.refetch,
    /** Whether at least one model provider is enabled */
    hasEnabledProviders,
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
