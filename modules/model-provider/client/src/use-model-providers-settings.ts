import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import {
  getModelMetadataForFrontend,
  hasEnabledModelProvider,
  type llmModelCostTrpc,
  mergeCustomModelMetadata,
  type ModelMetadataForFrontend,
  type modelProviderTrpc,
  type translateTrpc,
} from "@langwatch/model-provider-contract";
import { useMemo } from "react";

type ModelProviderClientMap = ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof llmModelCostTrpc> &
  ContractApiMap<typeof translateTrpc>;

/** The hooks Model provider's own contract generates. */
export const modelProviderClient: ModuleApi<ModelProviderClientMap> =
  createModuleApi<ModelProviderClientMap>();

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
