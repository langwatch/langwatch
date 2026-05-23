import { useCallback, useState } from "react";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { shouldAutoEnableAsDefault } from "../utils/modelProviderHelpers";

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
  reset: (
    provider: MaybeStoredModelProvider,
    enabledProvidersCount: number,
  ) => void;
};

export type UseDefaultProviderSelectionReturn =
  UseDefaultProviderSelectionState & UseDefaultProviderSelectionActions;

/**
 * Tracks the in-form state for the "Use as default" toggle and its three
 * model selectors. With the legacy Organization/Team/Project.{default,topicClustering,embeddings}Model
 * scalar columns gone, the form does not pre-fill from a project-scoped
 * default. Initial selector values are empty; the drawer's
 * `ModelProviderDefaultSection` reads `modelSelectorOptions` and picks
 * a flagship per provider when the toggle flips on. Writes route
 * through `setRoleAtScope` against the new ModelDefaultConfig table.
 */
export function useDefaultProviderSelection({
  enabledProvidersCount,
}: {
  provider: MaybeStoredModelProvider;
  enabledProvidersCount: number;
}): UseDefaultProviderSelectionReturn {
  const [useAsDefaultProvider, setUseAsDefaultProviderState] =
    useState<boolean>(() => shouldAutoEnableAsDefault({ enabledProvidersCount }));

  const [projectDefaultModel, setProjectDefaultModelState] =
    useState<string | null>(null);

  const [projectTopicClusteringModel, setProjectTopicClusteringModelState] =
    useState<string | null>(null);

  const [projectEmbeddingsModel, setProjectEmbeddingsModelState] =
    useState<string | null>(null);

  const setUseAsDefaultProvider = useCallback((use: boolean) => {
    setUseAsDefaultProviderState(use);
  }, []);

  const setProjectDefaultModel = useCallback((model: string | null) => {
    setProjectDefaultModelState(model);
  }, []);

  const setProjectTopicClusteringModel = useCallback(
    (model: string | null) => {
      setProjectTopicClusteringModelState(model);
    },
    [],
  );

  const setProjectEmbeddingsModel = useCallback((model: string | null) => {
    setProjectEmbeddingsModelState(model);
  }, []);

  const reset = useCallback(
    (
      _nextProvider: MaybeStoredModelProvider,
      nextEnabledProvidersCount: number,
    ) => {
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
