import {
  getModelMetadataForFrontend,
  hasEnabledModelProvider,
  mergeCustomModelMetadata,
  type ModelMetadataForFrontend,
} from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { modelProviderClient } from "./model-provider-client.ts";

export type { ModelMetadataForFrontend };

/** The catalogue half of the metadata map is the same for every project: built once per load. */
let registryMetadata: Record<string, ModelMetadataForFrontend> | undefined;
const catalogMetadata = (): Record<string, ModelMetadataForFrontend> => {
  registryMetadata ??= getModelMetadataForFrontend();
  return registryMetadata;
};

/** The project's model providers, their models' metadata, and whether any provider is on. */
export function useModelProvidersSettings({ projectId }: { projectId: string | undefined }) {
  const query = modelProviderClient.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) },
  );
  const providers = query.data;
  const isLoading = query.isLoading;

  /** Per-model metadata, keyed by `<provider>/<modelId>`. */
  const modelMetadata = useMemo(
    () => (providers ? mergeCustomModelMetadata(catalogMetadata(), providers) : undefined),
    [providers],
  );

  return {
    providers,
    modelMetadata,
    isLoading,
    /** Assumed true until the read lands, so no warning flashes on load. */
    hasEnabledProviders: isLoading || !providers || hasEnabledModelProvider(providers),
  } as const;
}
