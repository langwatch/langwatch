import { useMemo } from "react";
import {
  getModelMetadataForFrontend,
  mergeCustomModelMetadata,
  type ModelMetadataForFrontend,
} from "@langwatch/model-provider-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";

export type { ModelMetadataForFrontend };

/**
 * The registry half of the metadata map: the same catalog entries for every
 * project, so it is built once per page load rather than on each change to
 * the provider list.
 */
let registryMetadata: Record<string, ModelMetadataForFrontend> | undefined;
const catalogMetadata = (): Record<string, ModelMetadataForFrontend> =>
  (registryMetadata ??= getModelMetadataForFrontend());

export function useModelProvidersSettings(params: { projectId: string | undefined }) {
  const projectId = params.projectId ?? "";

  const modelProviders = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );

  const providers = modelProviders.data;
  const isLoading = modelProviders.isLoading;

  /**
   * Per-model metadata, keyed by `<provider>/<modelId>`.
   *
   * `getAllForProjectForFrontend` answers the provider map alone; it used to
   * answer `{ providers, modelMetadata }`, and reading `data?.modelMetadata`
   * off the map resolved through its index signature to a provider row, so
   * every lookup here missed. The value is the registry catalog merged with
   * the custom models declared on the configured providers — the exact
   * composition the dropped envelope carried — and both halves are pure, so
   * it is derived where it is read rather than fetched.
   *
   * Stays `undefined` until the providers arrive: callers gate their form
   * seeding on it, and a map without the project's custom models would seed
   * a token ceiling those models never agreed to.
   */
  const modelMetadata = useMemo(
    () => (providers ? mergeCustomModelMetadata(catalogMetadata(), providers) : undefined),
    [providers],
  );

  const hasEnabledProviders = useMemo(() => {
    // Default to true while loading or if providers data is not yet available
    // This prevents false positive warnings during initial load
    if (isLoading || !providers) return true;

    return Object.values(providers).some(
      (provider) =>
        typeof provider === "object" &&
        provider !== null &&
        "enabled" in provider &&
        provider.enabled,
    );
  }, [providers, isLoading]);

  return {
    /** Model providers configuration (enabled/disabled, custom keys, etc.) */
    providers,
    /** Metadata for all available models (supportedParameters, contextLength, etc.) */
    modelMetadata,
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
