import { useCallback, useEffect } from "react";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { useCredentialKeys } from "./useCredentialKeys";
import { useCustomModels } from "./useCustomModels";
import { useDefaultProviderSelection } from "./useDefaultProviderSelection";
import { type ExtraHeader, useExtraHeaders } from "./useExtraHeaders";
import { type FormSnapshot, useProviderFormSubmit } from "./useProviderFormSubmit";

export type UseModelProviderFormParams = {
  provider: MaybeStoredModelProvider;
  projectId: string | undefined;
  project:
    | {
        defaultModel?: string | null;
        topicClusteringModel?: string | null;
        embeddingsModel?: string | null;
      }
    | null
    | undefined;
  enabledProvidersCount: number;
  isUsingEnvVars?: boolean;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

export type UseModelProviderFormState = {
  useApiGateway: boolean;
  customKeys: Record<string, string>;
  displayKeys: Record<string, any>;
  initialKeys: Record<string, unknown>;
  extraHeaders: ExtraHeader[];
  customModels: CustomModelEntry[];
  customEmbeddingsModels: CustomModelEntry[];
  useAsDefaultProvider: boolean;
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  projectEmbeddingsModel: string | null;
  isSaving: boolean;
  errors: {
    customKeysRoot?: string;
  };
};

export type UseModelProviderFormActions = {
  setEnabled: (enabled: boolean) => Promise<void>;
  setUseApiGateway: (use: boolean) => void;
  setCustomKey: (key: string, value: string) => void;
  addExtraHeader: () => void;
  removeExtraHeader: (index: number) => void;
  toggleExtraHeaderConcealed: (index: number) => void;
  setExtraHeaderKey: (index: number, key: string) => void;
  setExtraHeaderValue: (index: number, value: string) => void;
  addCustomModel: (entry: CustomModelEntry) => void;
  removeCustomModel: (modelId: string) => void;
  setCustomModels: (models: CustomModelEntry[]) => void;
  addCustomEmbeddingsModel: (entry: CustomModelEntry) => void;
  removeCustomEmbeddingsModel: (modelId: string) => void;
  setUseAsDefaultProvider: (use: boolean) => void;
  setProjectDefaultModel: (model: string | null) => void;
  setProjectTopicClusteringModel: (model: string | null) => void;
  setProjectEmbeddingsModel: (model: string | null) => void;
  setManaged: (managed: boolean) => void;
  submit: () => Promise<void>;
};

export function useModelProviderForm(
  params: UseModelProviderFormParams,
): [UseModelProviderFormState, UseModelProviderFormActions] {
  const {
    provider,
    projectId,
    project,
    enabledProvidersCount,
    isUsingEnvVars,
    onSuccess,
    onError,
  } = params;

  // --- Sub-hooks ---
  const credentialKeysHook = useCredentialKeys({ provider });
  const extraHeadersHook = useExtraHeaders({ provider });
  const customModelsHook = useCustomModels({ provider });
  const defaultProviderHook = useDefaultProviderSelection({
    provider,
    project,
    enabledProvidersCount,
  });

  // Build snapshot callback for submit (avoids stale closures)
  const getFormSnapshot = useCallback(
    (): FormSnapshot => ({
      provider,
      projectId,
      isUsingEnvVars,
      customKeys: credentialKeysHook.customKeys,
      initialKeys: credentialKeysHook.originalStoredKeysRef.current,
      providerKeysSchema: credentialKeysHook.providerDefinition?.keysSchema,
      extraHeaders: extraHeadersHook.extraHeaders,
      customModels: customModelsHook.customModels,
      customEmbeddingsModels: customModelsHook.customEmbeddingsModels,
      useAsDefaultProvider: defaultProviderHook.useAsDefaultProvider,
      projectDefaultModel: defaultProviderHook.projectDefaultModel,
      projectTopicClusteringModel:
        defaultProviderHook.projectTopicClusteringModel,
      projectEmbeddingsModel: defaultProviderHook.projectEmbeddingsModel,
    }),
    [
      provider,
      projectId,
      isUsingEnvVars,
      credentialKeysHook.customKeys,
      credentialKeysHook.originalStoredKeysRef,
      credentialKeysHook.providerDefinition?.keysSchema,
      extraHeadersHook.extraHeaders,
      customModelsHook.customModels,
      customModelsHook.customEmbeddingsModels,
      defaultProviderHook.useAsDefaultProvider,
      defaultProviderHook.projectDefaultModel,
      defaultProviderHook.projectTopicClusteringModel,
      defaultProviderHook.projectEmbeddingsModel,
    ],
  );

  const formSubmitHook = useProviderFormSubmit({
    getFormSnapshot,
    onSuccess,
    onError,
  });

  // --- Cross-hook coordination: gateway toggle wires credential keys → extra headers ---
  const handleGatewayToggle = useCallback(
    (useGateway: boolean) => {
      if (provider.provider === "azure" && useGateway) {
        extraHeadersHook.ensureApiKeyHeader();
      }
    },
    [provider.provider, extraHeadersHook.ensureApiKeyHeader],
  );

  const setUseApiGateway = useCallback(
    (use: boolean) => {
      credentialKeysHook.setUseApiGateway(use, handleGatewayToggle);
    },
    [credentialKeysHook.setUseApiGateway, handleGatewayToggle],
  );

  // --- Single reset effect ---
  useEffect(() => {
    const nextUseApiGateway = credentialKeysHook.reset(provider);
    extraHeadersHook.reset(provider, nextUseApiGateway);
    customModelsHook.reset(provider);
    defaultProviderHook.reset(provider, project, enabledProvidersCount);
    formSubmitHook.reset();
  }, [
    provider.provider,
    provider.id,
    provider.enabled,
    provider.customKeys,
    provider.customModels,
    provider.customEmbeddingsModels,
    provider.extraHeaders,
    project?.defaultModel,
    project?.topicClusteringModel,
    project?.embeddingsModel,
    enabledProvidersCount,
  ]);

  // --- Assemble public interface ---
  return [
    {
      useApiGateway: credentialKeysHook.useApiGateway,
      customKeys: credentialKeysHook.customKeys,
      displayKeys: credentialKeysHook.displayKeys,
      initialKeys: credentialKeysHook.initialKeys,
      extraHeaders: extraHeadersHook.extraHeaders,
      customModels: customModelsHook.customModels,
      customEmbeddingsModels: customModelsHook.customEmbeddingsModels,
      useAsDefaultProvider: defaultProviderHook.useAsDefaultProvider,
      projectDefaultModel: defaultProviderHook.projectDefaultModel,
      projectTopicClusteringModel:
        defaultProviderHook.projectTopicClusteringModel,
      projectEmbeddingsModel: defaultProviderHook.projectEmbeddingsModel,
      isSaving: formSubmitHook.isSaving,
      errors: formSubmitHook.errors,
    },
    {
      setEnabled: formSubmitHook.setEnabled,
      setUseApiGateway,
      setCustomKey: credentialKeysHook.setCustomKey,
      addExtraHeader: extraHeadersHook.addExtraHeader,
      removeExtraHeader: extraHeadersHook.removeExtraHeader,
      toggleExtraHeaderConcealed: extraHeadersHook.toggleExtraHeaderConcealed,
      setExtraHeaderKey: extraHeadersHook.setExtraHeaderKey,
      setExtraHeaderValue: extraHeadersHook.setExtraHeaderValue,
      addCustomModel: customModelsHook.addCustomModel,
      removeCustomModel: customModelsHook.removeCustomModel,
      setCustomModels: customModelsHook.setCustomModels,
      addCustomEmbeddingsModel: customModelsHook.addCustomEmbeddingsModel,
      removeCustomEmbeddingsModel: customModelsHook.removeCustomEmbeddingsModel,
      setUseAsDefaultProvider: defaultProviderHook.setUseAsDefaultProvider,
      setProjectDefaultModel: defaultProviderHook.setProjectDefaultModel,
      setProjectTopicClusteringModel:
        defaultProviderHook.setProjectTopicClusteringModel,
      setProjectEmbeddingsModel: defaultProviderHook.setProjectEmbeddingsModel,
      setManaged: credentialKeysHook.setManaged,
      submit: formSubmitHook.submit,
    },
  ];
}
