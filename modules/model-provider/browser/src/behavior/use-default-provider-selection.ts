import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "@langwatch/model-provider-contract";
import { useCallback, useState } from "react";

import { shouldAutoEnableAsDefault } from "../model/model-provider-helpers.ts";

export type UseDefaultProviderSelectionState = {
  useAsDefaultProvider: boolean;
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  projectEmbeddingsModel: string | null;
};

export type UseDefaultProviderSelectionActions = {
  setUseAsDefaultProvider: (use: boolean) => void;
  setProjectDefaultModel: (model: string | null) => void;
  setProjectTopicClusteringModel: (model: string | null) => void;
  setProjectEmbeddingsModel: (model: string | null) => void;
  reset: (provider: MaybeStoredModelProvider, enabledProvidersCount: number) => void;
};

export type UseDefaultProviderSelectionReturn = UseDefaultProviderSelectionState &
  UseDefaultProviderSelectionActions;

/**
 * Tracks the in-form state for the "Use as default" toggle and its three
 * model selectors. Selectors start empty, not pre-filled, since the legacy
 * scalar columns are gone; writes route through the default-assignment service.
 */
export function useDefaultProviderSelection({
  enabledProvidersCount,
}: {
  provider: MaybeStoredModelProvider;
  enabledProvidersCount: number;
}): UseDefaultProviderSelectionReturn {
  const [useAsDefaultProvider, setUseAsDefaultProviderState] = useState<boolean>(() =>
    shouldAutoEnableAsDefault({ enabledProvidersCount }),
  );

  const [projectDefaultModel, setProjectDefaultModelState] = useState<string | null>(null);

  const [projectTopicClusteringModel, setProjectTopicClusteringModelState] = useState<
    string | null
  >(null);

  const [projectEmbeddingsModel, setProjectEmbeddingsModelState] = useState<string | null>(null);

  const setUseAsDefaultProvider = useCallback((use: boolean) => {
    setUseAsDefaultProviderState(use);
  }, []);

  const setProjectDefaultModel = useCallback((model: string | null) => {
    setProjectDefaultModelState(model);
  }, []);

  const setProjectTopicClusteringModel = useCallback((model: string | null) => {
    setProjectTopicClusteringModelState(model);
  }, []);

  const setProjectEmbeddingsModel = useCallback((model: string | null) => {
    setProjectEmbeddingsModelState(model);
  }, []);

  const reset = useCallback(
    (_nextProvider: MaybeStoredModelProvider, nextEnabledProvidersCount: number) => {
      setUseAsDefaultProviderState(
        shouldAutoEnableAsDefault({
          enabledProvidersCount: nextEnabledProvidersCount,
        }),
      );
      setProjectDefaultModelState(null);
      setProjectTopicClusteringModelState(null);
      setProjectEmbeddingsModelState(null);
    },
    [],
  );

  return {
    useAsDefaultProvider,
    projectDefaultModel,
    projectTopicClusteringModel,
    projectEmbeddingsModel,
    setUseAsDefaultProvider,
    setProjectDefaultModel,
    setProjectTopicClusteringModel,
    setProjectEmbeddingsModel,
    reset,
  };
}
