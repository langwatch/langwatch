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
import {
  buildCustomKeyState,
  filterMaskedApiKeys,
  getDisplayKeysForProvider,
  getEffectiveDefaults,
  getSchemaShape,
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
  resolveModelForProvider,
  shouldAutoEnableAsDefault,
} from "../utils/modelProviderHelpers";

type SelectOption = { value: string; label: string };

export type ExtraHeader = { key: string; value: string; concealed?: boolean };

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
  customModels: SelectOption[];
  customEmbeddingsModels: SelectOption[];
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
  setCustomModels: (options: SelectOption[]) => void;
  setCustomEmbeddingsModels: (options: SelectOption[]) => void;
  addCustomModelsFromText: (text: string) => void;
  addCustomEmbeddingsFromText: (text: string) => void;
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

  // Compute effective defaults using unified helper
  const effectiveDefaults = useMemo(
    () => getEffectiveDefaults(project),
    [project],
  );
  // When this is the only enabled provider, resolve defaults to models from this provider
  // so the state is correct from initialization (no downstream useEffect needed)
  const resolvedDefaults = useMemo(() => {
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
  }, [
    effectiveDefaults,
    enabledProvidersCount,
    provider.provider,
    provider.models,
    provider.embeddingsModels,
  ]);

  const {
    defaultModel: initialProjectDefaultModel,
    topicClusteringModel: initialProjectTopicClusteringModel,
    embeddingsModel: initialProjectEmbeddingsModel,
  } = resolvedDefaults;

  const utils = api.useContext();
  const updateMutation = api.modelProvider.update.useMutation();
  const updateProjectDefaultModelsMutation =
    api.project.updateProjectDefaultModels.useMutation();

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  // Track the originally stored keys to switch projections when toggling gateway
  const originalStoredKeysRef = useRef<Record<string, unknown>>(
    (provider.customKeys as Record<string, unknown>) || {},
  );

  const originalSchemaShape = useMemo<Record<string, unknown>>(() => {
    return providerDefinition?.keysSchema
      ? getSchemaShape(providerDefinition.keysSchema)
      : {};
  }, [providerDefinition?.keysSchema]);

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
    buildCustomKeyState(
      displayKeys,
      originalStoredKeysRef.current ?? {},
      undefined,
      {
        providerEnabledWithEnvVars: provider.enabled,
      },
    ),
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

  // Auto-enable toggle if this provider is used for the Default Model (matching badge logic)
  // Also auto-enable when this is the only enabled provider (first provider setup)
  const [useAsDefaultProvider, setUseAsDefaultProvider] = useState<boolean>(
    () =>
      shouldAutoEnableAsDefault({
        providerKey: provider.provider,
        project,
        enabledProvidersCount,
      }),
  );
  const [projectDefaultModel, setProjectDefaultModel] = useState<string | null>(
    initialProjectDefaultModel,
  );
  const [projectTopicClusteringModel, setProjectTopicClusteringModel] =
    useState<string | null>(initialProjectTopicClusteringModel);
  const [projectEmbeddingsModel, setProjectEmbeddingsModel] = useState<
    string | null
  >(initialProjectEmbeddingsModel);

  const [isSaving, setIsSaving] = useState(false);
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

    setUseApiGatewayState(nextUseApiGateway);

    const nextDisplayKeys = getDisplayKeysForProvider(
      provider.provider,
      nextUseApiGateway,
      originalSchemaShape,
    );

    setCustomKeys(() =>
      buildCustomKeyState(nextDisplayKeys, storedKeys, undefined, {
        providerEnabledWithEnvVars: provider.enabled,
      }),
    );

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

    // Auto-enable the toggle if this provider is used for the Default Model (matching badge logic)
    // Also auto-enable when this is the only enabled provider (first provider setup)
    setUseAsDefaultProvider(
      shouldAutoEnableAsDefault({
        providerKey: provider.provider,
        project,
        enabledProvidersCount,
      }),
    );

    setProjectDefaultModel(initialProjectDefaultModel);
    setProjectTopicClusteringModel(initialProjectTopicClusteringModel);
    setProjectEmbeddingsModel(initialProjectEmbeddingsModel);
    setErrors({});
    setIsSaving(false);
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
    project,
    enabledProvidersCount,
  ]);

  const setEnabled = useCallback(
    async (newEnabled: boolean) => {
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
          description: err instanceof Error ? err.message : String(err),
          type: "error",
          duration: 4000,
          meta: { closable: true },
        });
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
    setCustomKeys((prev) => ({ ...prev, [key]: value }));
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

  const addCustomModelsFromText = useCallback((text: string) => {
    const newModels = text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({ value: s, label: s }));
    setCustomModels((prev) => {
      const existingValues = new Set(prev.map((m) => m.value));
      const uniqueNew = newModels.filter((m) => !existingValues.has(m.value));
      return [...prev, ...uniqueNew];
    });
  }, []);

  const addCustomEmbeddingsFromText = useCallback((text: string) => {
    const newModels = text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({ value: s, label: s }));
    setCustomEmbeddingsModels((prev) => {
      const existingValues = new Set(prev.map((m) => m.value));
      const uniqueNew = newModels.filter((m) => !existingValues.has(m.value));
      return [...prev, ...uniqueNew];
    });
  }, []);

  const submit = useCallback(async () => {
    setIsSaving(true);
    setErrors({});
    try {
      // Check if user modified non-API-key fields (like URLs) when using env vars
      const hasNonApiKeyChanges =
        isUsingEnvVars &&
        hasUserModifiedNonApiKeyFields(
          customKeys,
          originalStoredKeysRef.current,
        );

      // Validate if not using env vars, OR if using env vars but has non-API-key changes
      if (!isUsingEnvVars || hasNonApiKeyChanges) {
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
      }

      // Determine what customKeys to send:
      // - Not using env vars: send all customKeys
      // - Using env vars with new API key or non-API-key changes: send the keys
      // - Using env vars without changes: send undefined (don't update)
      let customKeysToSend: Record<string, unknown> | undefined;
      const userEnteredNewKey = hasUserEnteredNewApiKey(customKeys);
      if (!isUsingEnvVars) {
        customKeysToSend = { ...customKeys };
      } else if (userEnteredNewKey || hasNonApiKeyChanges) {
        // User entered a new key or modified non-API-key fields - send the keys
        customKeysToSend = userEnteredNewKey
          ? { ...customKeys }
          : filterMaskedApiKeys(customKeys);
      } else {
        customKeysToSend = undefined;
      }

      // Build custom keys to send (merge azure headers when applicable)
      if (!isUsingEnvVars && provider.provider === "azure") {
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
        await updateProjectDefaultModelsMutation.mutateAsync({
          projectId,
          defaultModel: projectDefaultModel ?? undefined,
          topicClusteringModel: projectTopicClusteringModel ?? undefined,
          embeddingsModel: projectEmbeddingsModel ?? undefined,
        });

        // Invalidate organization query to refetch project data
        // This triggers useOrganizationTeamProject to refetch automatically
        void utils.organization.getAll.invalidate();
      }

      toaster.create({
        title: "Model Provider Updated",
        type: "success",
        duration: 3000,
        meta: { closable: true },
      });
      onSuccess?.();
    } catch (err) {
      onError?.(err);
      toaster.create({
        title: "Failed to save settings",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 4000,
        meta: { closable: true },
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    isUsingEnvVars,
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
    updateProjectDefaultModelsMutation,
    utils,
  ]);

  return [
    {
      useApiGateway,
      customKeys,
      displayKeys,
      initialKeys: originalStoredKeysRef.current,
      extraHeaders,
      customModels,
      customEmbeddingsModels,
      useAsDefaultProvider,
      projectDefaultModel,
      projectTopicClusteringModel,
      projectEmbeddingsModel,
      isSaving,
      errors,
    },
    {
      setEnabled,
      setUseApiGateway,
      setCustomKey,
      addExtraHeader,
      removeExtraHeader,
      toggleExtraHeaderConcealed,
      setExtraHeaderKey,
      setExtraHeaderValue,
      setCustomModels,
      setCustomEmbeddingsModels,
      addCustomModelsFromText,
      addCustomEmbeddingsFromText,
      setUseAsDefaultProvider,
      setProjectDefaultModel,
      setProjectTopicClusteringModel,
      setProjectEmbeddingsModel,
      setManaged,
      submit,
    },
  ];
}
