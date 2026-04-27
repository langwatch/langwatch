import { useCallback, useState } from "react";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";

export type UseCustomModelsState = {
  customModels: CustomModelEntry[];
  customEmbeddingsModels: CustomModelEntry[];
};

export type UseCustomModelsActions = {
  addCustomModel: (entry: CustomModelEntry) => void;
  removeCustomModel: (modelId: string) => void;
  setCustomModels: (models: CustomModelEntry[]) => void;
  addCustomEmbeddingsModel: (entry: CustomModelEntry) => void;
  removeCustomEmbeddingsModel: (modelId: string) => void;
  reset: (provider: MaybeStoredModelProvider) => void;
};

export type UseCustomModelsReturn = UseCustomModelsState &
  UseCustomModelsActions;

export function useCustomModels({
  provider,
}: {
  provider: MaybeStoredModelProvider;
}): UseCustomModelsReturn {
  const [customModels, setCustomModelsState] = useState<CustomModelEntry[]>(
    provider.customModels ?? [],
  );
  const [customEmbeddingsModels, setCustomEmbeddingsModelsState] = useState<
    CustomModelEntry[]
  >(provider.customEmbeddingsModels ?? []);

  const addCustomModel = useCallback((entry: CustomModelEntry) => {
    setCustomModelsState((prev) => {
      if (prev.some((m) => m.modelId === entry.modelId)) return prev;
      return [...prev, entry];
    });
  }, []);

  const removeCustomModel = useCallback((modelId: string) => {
    setCustomModelsState((prev) => prev.filter((m) => m.modelId !== modelId));
  }, []);

  const setCustomModels = useCallback((models: CustomModelEntry[]) => {
    setCustomModelsState(models);
  }, []);

  const addCustomEmbeddingsModel = useCallback((entry: CustomModelEntry) => {
    setCustomEmbeddingsModelsState((prev) => {
      if (prev.some((m) => m.modelId === entry.modelId)) return prev;
      return [...prev, entry];
    });
  }, []);

  const removeCustomEmbeddingsModel = useCallback((modelId: string) => {
    setCustomEmbeddingsModelsState((prev) =>
      prev.filter((m) => m.modelId !== modelId),
    );
  }, []);

  const reset = useCallback((nextProvider: MaybeStoredModelProvider) => {
    setCustomModelsState(nextProvider.customModels ?? []);
    setCustomEmbeddingsModelsState(nextProvider.customEmbeddingsModels ?? []);
  }, []);

  return {
    customModels,
    customEmbeddingsModels,
    addCustomModel,
    removeCustomModel,
    setCustomModels,
    addCustomEmbeddingsModel,
    removeCustomEmbeddingsModel,
    reset,
  };
}
