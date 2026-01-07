import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { toaster } from "../components/ui/toaster";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../server/modelProviders/registry";
import { api } from "../utils/api";
import { isProviderUsedForDefaultModels } from "../utils/modelProviderHelpers";

type SelectOption = { value: string; label: string };

export type ExtraHeader = { key: string; value: string; concealed?: boolean };

export type UseModelProviderFormParams = {
  provider: MaybeStoredModelProvider;
  projectId: string | undefined;
  projectDefaultModel?: string | null;
  projectTopicClusteringModel?: string | null;
  projectEmbeddingsModel?: string | null;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  onDefaultModelsUpdated?: (models: {
    defaultModel?: string;
    topicClusteringModel?: string;
    embeddingsModel?: string;
  }) => void;
};

export type UseModelProviderFormState = {
  enabled: boolean;
  useApiGateway: boolean;
  customKeys: Record<string, string>;
  displayKeys: Record<string, any>;
  extraHeaders: ExtraHeader[];
  customModels: SelectOption[];
  customEmbeddingsModels: SelectOption[];
  chatModelOptions: SelectOption[];
  embeddingModelOptions: SelectOption[];
  defaultModel: string | null;
  useAsDefaultProvider: boolean;
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  projectEmbeddingsModel: string | null;
  isSaving: boolean;
  isToggling: boolean;
  errors: {
    customKeysRoot?: string;
  };
};

export type UseModelProviderFormActions = {
  setEnabled: (enabled: boolean) => Promise<void>;
  setEnabledLocal: (enabled: boolean) => void;
  setUseApiGateway: (use: boolean) => void;
  setCustomKey: (key: string, value: string) => void;
  addExtraHeader: () => void;
  removeExtraHeader: (index: number) => void;
  toggleExtraHeaderConcealed: (index: number) => void;
  setExtraHeaderKey: (index: number, key: string) => void;
  setExtraHeaderValue: (index: number, value: string) => void;
  setCustomModels: (options: SelectOption[]) => void;
  addCustomModelsFromText: (text: string) => void;
  setCustomEmbeddingsModels: (options: SelectOption[]) => void;
  addCustomEmbeddingsFromText: (text: string) => void;
  setDefaultModel: (model: string | null) => void;
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
    projectDefaultModel: initialProjectDefaultModel,
    projectTopicClusteringModel: initialProjectTopicClusteringModel,
    projectEmbeddingsModel: initialProjectEmbeddingsModel,
    onSuccess,
    onError,
    onDefaultModelsUpdated,
  } = params;

  const updateMutation = api.modelProvider.update.useMutation();
  const updateDefaultModelMutation =
    api.project.updateDefaultModel.useMutation();
  const updateTopicClusteringModelMutation =
    api.project.updateTopicClusteringModel.useMutation();
  const updateEmbeddingsModelMutation =
    api.project.updateEmbeddingsModel.useMutation();

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  // Track the originally stored keys to switch projections when toggling gateway
  const originalStoredKeysRef = useRef<Record<string, unknown>>(
    (provider.customKeys as Record<string, unknown>) || {},
  );

  /**
   * Single Responsibility: Extract the underlying shape from a Zod schema to list credential keys.
   */
  const getSchemaShape = (schema: any) => {
    if (schema?.shape) return schema.shape;
    if (schema?._def?.schema) return schema._def.schema.shape;
    return {} as Record<string, any>;
  };

  /**
   * Single Responsibility: Determine which credential keys should be visible for the active provider and mode.
   */
  const getDisplayKeysForProvider = (
    providerName: string,
    useProviderApiGateway: boolean,
    schemaShape: Record<string, any>,
  ) => {
    if (providerName === "azure") {
      if (useProviderApiGateway) {
        return {
          AZURE_API_GATEWAY_BASE_URL: schemaShape.AZURE_API_GATEWAY_BASE_URL,
          AZURE_API_GATEWAY_VERSION: schemaShape.AZURE_API_GATEWAY_VERSION,
        } as Record<string, any>;
      }
      return {
        AZURE_OPENAI_API_KEY: schemaShape.AZURE_OPENAI_API_KEY,
        AZURE_OPENAI_ENDPOINT: schemaShape.AZURE_OPENAI_ENDPOINT,
      } as Record<string, any>;
    }

    return schemaShape;
  };

  /**
   * Single Responsibility: Build the credential form state while preserving prior user input when applicable.
   */
  const buildCustomKeyState = (
    displayKeyMap: Record<string, any>,
    storedKeys: Record<string, unknown>,
    previousKeys?: Record<string, string>,
  ) => {
    if (previousKeys?.MANAGED) {
      return previousKeys;
    }
    const result: Record<string, string> = {};
    Object.keys(displayKeyMap ?? {}).forEach((key) => {
      if (
        previousKeys &&
        Object.prototype.hasOwnProperty.call(previousKeys, key)
      ) {
        const previousValue = previousKeys[key];
        if (typeof previousValue === "string") {
          result[key] = previousValue;
          return;
        }
      }

      const storedValue = storedKeys[key];
      result[key] = typeof storedValue === "string" ? storedValue : "";
    });

    return result;
  };

  const originalSchemaShape = useMemo<Record<string, any>>(() => {
    return providerDefinition?.keysSchema
      ? getSchemaShape(providerDefinition.keysSchema)
      : {};
  }, [providerDefinition?.keysSchema]);

  const [enabled, setEnabledState] = useState<boolean>(provider.enabled);

  const initialUseApiGateway = useMemo(() => {
    if (provider.provider === "azure" && provider.customKeys) {
      return !!(provider.customKeys as any).AZURE_API_GATEWAY_BASE_URL;
    }
    return false;
  }, [provider.provider, provider.customKeys]);

  const [useApiGateway, setUseApiGatewayState] =
    useState<boolean>(initialUseApiGateway);

  const displayKeys = useMemo(() => {
    return getDisplayKeysForProvider(
      provider.provider,
      useApiGateway,
      originalSchemaShape,
    );
  }, [provider.provider, useApiGateway, originalSchemaShape]);

  const [customKeys, setCustomKeys] = useState<Record<string, string>>(() =>
    buildCustomKeyState(displayKeys, originalStoredKeysRef.current ?? {}),
  );

  const [extraHeaders, setExtraHeaders] = useState<ExtraHeader[]>(
    (provider.extraHeaders ?? []).map((h) => ({
      key: h.key,
      value: h.value,
      concealed: !!h.value,
    })),
  );

  const getStoredModelOptions = (
    models: string[] | undefined,
    providerName: string,
    mode: "chat" | "embedding",
  ): SelectOption[] => {
    if (!models || models.length === 0) {
      return getProviderModelOptions(providerName, mode);
    }
    return models.map((model) => ({ value: model, label: model }));
  };

  const [customModels, setCustomModels] = useState<SelectOption[]>(
    getStoredModelOptions(
      provider.models ?? undefined,
      provider.provider,
      "chat",
    ),
  );
  const [customEmbeddingsModels, setCustomEmbeddingsModels] = useState<
    SelectOption[]
  >(
    getStoredModelOptions(
      provider.embeddingsModels ?? undefined,
      provider.provider,
      "embedding",
    ),
  );

  const chatModelOptions = useMemo(
    () => getProviderModelOptions(provider.provider, "chat"),
    [provider.provider],
  );
  const embeddingModelOptions = useMemo(
    () => getProviderModelOptions(provider.provider, "embedding"),
    [provider.provider],
  );

  const [defaultModel, setDefaultModel] = useState<string | null>(
    initialProjectDefaultModel ?? null,
  );

  const [useAsDefaultProvider, setUseAsDefaultProvider] =
    useState<boolean>(false);
  const [projectDefaultModel, setProjectDefaultModel] = useState<string | null>(
    initialProjectDefaultModel ?? null,
  );
  const [projectTopicClusteringModel, setProjectTopicClusteringModel] =
    useState<string | null>(initialProjectTopicClusteringModel ?? null);
  const [projectEmbeddingsModel, setProjectEmbeddingsModel] =
    useState<string | null>(initialProjectEmbeddingsModel ?? null);

  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [errors, setErrors] = useState<{ customKeysRoot?: string }>({});

  const setManaged = useCallback((managed: boolean) => {
    if (managed) {
      setCustomKeys({ MANAGED: "true" });
    } else {
      setCustomKeys({});
    }
  }, []);

  useEffect(() => {
    const storedKeys = (provider.customKeys as Record<string, unknown>) ?? {};
    originalStoredKeysRef.current = storedKeys;

    const nextUseApiGateway =
      provider.provider === "azure" && provider.customKeys
        ? !!(provider.customKeys as any).AZURE_API_GATEWAY_BASE_URL
        : false;

    setEnabledState(provider.enabled);
    setUseApiGatewayState(nextUseApiGateway);

    const nextDisplayKeys = getDisplayKeysForProvider(
      provider.provider,
      nextUseApiGateway,
      originalSchemaShape,
    );

    setCustomKeys(() => buildCustomKeyState(nextDisplayKeys, storedKeys));

    let nextExtraHeaders = (provider.extraHeaders ?? []).map((header) => ({
      key: header.key,
      value: header.value,
      concealed: !!header.value,
    }));

    if (
      provider.provider === "azure" &&
      nextUseApiGateway &&
      nextExtraHeaders.length === 0
    ) {
      nextExtraHeaders = [{ key: "api-key", value: "", concealed: false }];
    }

    setExtraHeaders(nextExtraHeaders);

    setCustomModels(
      getStoredModelOptions(
        provider.models ?? undefined,
        provider.provider,
        "chat",
      ),
    );

    setCustomEmbeddingsModels(
      getStoredModelOptions(
        provider.embeddingsModels ?? undefined,
        provider.provider,
        "embedding",
      ),
    );

    setDefaultModel(initialProjectDefaultModel ?? null);
    
    // Auto-enable the toggle if this provider is currently being used for any default models
    const isUsedForDefaults = isProviderUsedForDefaultModels(
      provider.provider,
      initialProjectDefaultModel ?? null,
      initialProjectTopicClusteringModel ?? null,
      initialProjectEmbeddingsModel ?? null
    );
    setUseAsDefaultProvider(isUsedForDefaults);
    
    setProjectDefaultModel(initialProjectDefaultModel ?? null);
    setProjectTopicClusteringModel(initialProjectTopicClusteringModel ?? null);
    setProjectEmbeddingsModel(initialProjectEmbeddingsModel ?? null);
    setErrors({});
    setIsSaving(false);
    setIsToggling(false);
  }, [
    provider.provider,
    provider.id,
    provider.enabled,
    provider.customKeys,
    provider.extraHeaders,
    originalSchemaShape,
    initialProjectDefaultModel,
    initialProjectTopicClusteringModel,
    initialProjectEmbeddingsModel,
  ]);

  const setEnabledLocal = useCallback((newEnabled: boolean) => {
    setEnabledState(newEnabled);
  }, []);

  const setEnabled = useCallback(
    async (newEnabled: boolean) => {
      setEnabledState(newEnabled);
      setIsToggling(true);
      try {
        await updateMutation.mutateAsync({
          id: provider.id,
          projectId: projectId ?? "",
          provider: provider.provider,
          enabled: newEnabled,
          customKeys: provider.customKeys as any,
          customModels: provider.models ?? [],
          customEmbeddingsModels: provider.embeddingsModels ?? [],
        });
        onSuccess?.();
      } catch (err) {
        onError?.(err);
        toaster.create({
          title: "Failed to update provider",
          description: String(err),
          type: "error",
          duration: 4000,
          meta: { closable: true },
        });
      } finally {
        setIsToggling(false);
      }
    },
    [
      onSuccess,
      onError,
      provider.id,
      provider.provider,
      provider.customKeys,
      provider.models,
      provider.embeddingsModels,
      projectId,
      updateMutation,
    ],
  );

  const setUseApiGateway = useCallback(
    (use: boolean) => {
      setUseApiGatewayState(use);
      setCustomKeys((previousKeys) => {
        originalStoredKeysRef.current = {
          ...originalStoredKeysRef.current,
          ...previousKeys,
        };

        const nextDisplayKeys = getDisplayKeysForProvider(
          provider.provider,
          use,
          originalSchemaShape,
        );

        return buildCustomKeyState(
          nextDisplayKeys,
          originalStoredKeysRef.current,
          previousKeys,
        );
      });

      if (provider.provider === "azure" && use && extraHeaders.length === 0) {
        setExtraHeaders([{ key: "api-key", value: "", concealed: false }]);
      }
    },
    [provider.provider, extraHeaders.length, originalSchemaShape],
  );

  const setCustomKey = useCallback((key: string, value: string) => {
    setCustomKeys((prev) => {
      const next = { ...prev, [key]: value };
      originalStoredKeysRef.current = {
        ...originalStoredKeysRef.current,
        [key]: value,
      };
      return next;
    });
  }, []);

  const addExtraHeader = useCallback(() => {
    setExtraHeaders((prev) => [
      ...prev,
      { key: "", value: "", concealed: false },
    ]);
  }, []);

  const removeExtraHeader = useCallback((index: number) => {
    setExtraHeaders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleExtraHeaderConcealed = useCallback((index: number) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, concealed: !h.concealed } : h)),
    );
  }, []);

  const setExtraHeaderKey = useCallback((index: number, key: string) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, key } : h)),
    );
  }, []);

  const setExtraHeaderValue = useCallback((index: number, value: string) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, value } : h)),
    );
  }, []);

  const addFromCommaText = (
    text: string,
    current: SelectOption[],
  ): SelectOption[] => {
    const tokens = text
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const existing = new Set(current.map((v) => v.value));
    const toAdd = tokens
      .filter((t) => !existing.has(t))
      .map((t) => ({ label: t, value: t }));
    return [...current, ...toAdd];
  };

  const addCustomModelsFromText = useCallback((text: string) => {
    setCustomModels((prev) => addFromCommaText(text, prev));
  }, []);

  const addCustomEmbeddingsFromText = useCallback((text: string) => {
    setCustomEmbeddingsModels((prev) => addFromCommaText(text, prev));
  }, []);

  const submit = useCallback(async () => {
    setIsSaving(true);
    setErrors({});
    try {
      // Validate keys according to schema if present
      const keysSchema = providerDefinition?.keysSchema
        ? z
            .union([
              providerDefinition.keysSchema,
              z.object({ MANAGED: z.string() }),
            ])
            .optional()
            .nullable()
        : z.object({ MANAGED: z.string() }).optional().nullable();
      const keysToValidate: Record<string, unknown> = { ...customKeys };
      const parsed = (keysSchema as any).safeParse
        ? (keysSchema as any).safeParse(keysToValidate)
        : { success: true };
      if (!parsed.success) {
        setErrors({
          customKeysRoot: fromZodError(parsed.error as ZodError).message,
        });
        setIsSaving(false);
        return;
      }

      // Build custom keys to send (merge azure headers when applicable)
      let customKeysToSend: Record<string, unknown> = { ...customKeys };
      if (provider.provider === "azure") {
        const headerMap: Record<string, string> = {};
        (extraHeaders ?? []).forEach((header) => {
          if (header.key.trim() && header.value.trim()) {
            const sanitizedKey = header.key
              .trim()
              .replace(/[^a-zA-Z0-9_-]/g, "_");
            if (sanitizedKey) headerMap[sanitizedKey] = header.value.trim();
          }
        });
        customKeysToSend = { ...customKeysToSend, ...headerMap };
      }

      // Strip concealed for send
      const extraHeadersToSend = (extraHeaders ?? [])
        .filter((h) => h.key?.trim())
        .map(({ key, value }) => ({ key, value }));

      await updateMutation.mutateAsync({
        id: provider.id,
        projectId: projectId ?? "",
        provider: provider.provider,
        enabled: true, // Always enable when saving through the form
        customKeys: customKeysToSend,
        customModels: (customModels ?? []).map((m) => m.value),
        customEmbeddingsModels: (customEmbeddingsModels ?? []).map(
          (m) => m.value,
        ),
        extraHeaders: extraHeadersToSend,
      });

      // Update project default models if useAsDefaultProvider is enabled
      if (useAsDefaultProvider && projectId) {
        const updatePromises: Promise<unknown>[] = [];

        if (projectDefaultModel) {
          updatePromises.push(
            updateDefaultModelMutation.mutateAsync({
              projectId,
              defaultModel: projectDefaultModel,
            }),
          );
        }

        if (projectTopicClusteringModel) {
          updatePromises.push(
            updateTopicClusteringModelMutation.mutateAsync({
              projectId,
              topicClusteringModel: projectTopicClusteringModel,
            }),
          );
        }

        if (projectEmbeddingsModel) {
          updatePromises.push(
            updateEmbeddingsModelMutation.mutateAsync({
              projectId,
              embeddingsModel: projectEmbeddingsModel,
            }),
          );
        }

        await Promise.all(updatePromises);
        
        // Notify parent component about updated default models
        onDefaultModelsUpdated?.({
          defaultModel: projectDefaultModel ?? undefined,
          topicClusteringModel: projectTopicClusteringModel ?? undefined,
          embeddingsModel: projectEmbeddingsModel ?? undefined,
        });
      }

      toaster.create({
        title: "API Keys Updated",
        type: "success",
        duration: 3000,
        meta: { closable: true },
      });
      onSuccess?.();
    } catch (err) {
      onError?.(err);
      toaster.create({
        title: "Failed to save settings",
        description: String(err),
        type: "error",
        duration: 4000,
        meta: { closable: true },
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    customKeys,
    customModels,
    customEmbeddingsModels,
    extraHeaders,
    onError,
    onSuccess,
    projectId,
    providerDefinition?.keysSchema,
    provider.id,
    provider.provider,
    updateMutation,
    useAsDefaultProvider,
    projectDefaultModel,
    projectTopicClusteringModel,
    projectEmbeddingsModel,
    updateDefaultModelMutation,
    updateTopicClusteringModelMutation,
    updateEmbeddingsModelMutation,
  ]);

  return [
    {
      enabled,
      useApiGateway,
      customKeys,
      displayKeys,
      extraHeaders,
      customModels,
      customEmbeddingsModels,
      chatModelOptions,
      embeddingModelOptions,
      defaultModel,
      useAsDefaultProvider,
      projectDefaultModel,
      projectTopicClusteringModel,
      projectEmbeddingsModel,
      isSaving,
      isToggling,
      errors,
    },
    {
      setEnabled,
      setEnabledLocal,
      setUseApiGateway,
      setCustomKey,
      addExtraHeader,
      removeExtraHeader,
      toggleExtraHeaderConcealed,
      setExtraHeaderKey,
      setExtraHeaderValue,
      setCustomModels,
      addCustomModelsFromText,
      setCustomEmbeddingsModels,
      addCustomEmbeddingsFromText,
      setDefaultModel,
      setUseAsDefaultProvider,
      setProjectDefaultModel,
      setProjectTopicClusteringModel,
      setProjectEmbeddingsModel,
      setManaged,
      submit,
    },
  ];
}
