import { useCallback, useMemo, useState } from "react";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import {
  getEffectiveDefaults,
  resolveModelForProvider,
  shouldAutoEnableAsDefault,
} from "../utils/modelProviderHelpers";

export type ProjectLike = {
  defaultModel?: string | null;
  topicClusteringModel?: string | null;
  embeddingsModel?: string | null;
} | null | undefined;

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
    project: ProjectLike,
    enabledProvidersCount: number,
  ) => void;
};

export type UseDefaultProviderSelectionReturn =
  UseDefaultProviderSelectionState & UseDefaultProviderSelectionActions;

function computeResolvedDefaults({
  project,
  provider,
  enabledProvidersCount,
}: {
  project: ProjectLike;
  provider: MaybeStoredModelProvider;
  enabledProvidersCount: number;
}) {
  const effectiveDefaults = getEffectiveDefaults(project);
  const { defaultModel, topicClusteringModel, embeddingsModel } =
    effectiveDefaults;

  if (enabledProvidersCount !== 1) {
    return { defaultModel, topicClusteringModel, embeddingsModel };
  }

  return {
    defaultModel: resolveModelForProvider({
      current: defaultModel,
      providerKey: provider.provider,
      storedModels: provider.models,
      mode: "chat",
    }),
    topicClusteringModel: resolveModelForProvider({
      current: topicClusteringModel,
      providerKey: provider.provider,
      storedModels: provider.models,
      mode: "chat",
    }),
    embeddingsModel: resolveModelForProvider({
      current: embeddingsModel,
      providerKey: provider.provider,
      storedModels: provider.embeddingsModels,
      mode: "embedding",
    }),
  };
}

export function useDefaultProviderSelection({
  provider,
  project,
  enabledProvidersCount,
}: {
  provider: MaybeStoredModelProvider;
  project: ProjectLike;
  enabledProvidersCount: number;
}): UseDefaultProviderSelectionReturn {
  const resolvedDefaults = useMemo(
    () => computeResolvedDefaults({ project, provider, enabledProvidersCount }),
    [
      project,
      enabledProvidersCount,
      provider.provider,
      provider.models,
      provider.embeddingsModels,
    ],
  );

  const {
    defaultModel: initialProjectDefaultModel,
    topicClusteringModel: initialProjectTopicClusteringModel,
    embeddingsModel: initialProjectEmbeddingsModel,
  } = resolvedDefaults;

  const [useAsDefaultProvider, setUseAsDefaultProviderState] =
    useState<boolean>(() =>
      shouldAutoEnableAsDefault({
        providerKey: provider.provider,
        project,
        enabledProvidersCount,
      }),
    );

  const [projectDefaultModel, setProjectDefaultModelState] =
    useState<string | null>(initialProjectDefaultModel);

  const [projectTopicClusteringModel, setProjectTopicClusteringModelState] =
    useState<string | null>(initialProjectTopicClusteringModel);

  const [projectEmbeddingsModel, setProjectEmbeddingsModelState] =
    useState<string | null>(initialProjectEmbeddingsModel);

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
      nextProvider: MaybeStoredModelProvider,
      nextProject: ProjectLike,
      nextEnabledProvidersCount: number,
    ) => {
      setUseAsDefaultProviderState(
        shouldAutoEnableAsDefault({
          providerKey: nextProvider.provider,
          project: nextProject,
          enabledProvidersCount: nextEnabledProvidersCount,
        }),
      );

      const nextResolved = computeResolvedDefaults({
        project: nextProject,
        provider: nextProvider,
        enabledProvidersCount: nextEnabledProvidersCount,
      });

      setProjectDefaultModelState(nextResolved.defaultModel);
      setProjectTopicClusteringModelState(nextResolved.topicClusteringModel);
      setProjectEmbeddingsModelState(nextResolved.embeddingsModel);
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
