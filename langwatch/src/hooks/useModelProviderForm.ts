import { useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toaster } from "../components/ui/toaster";
import {
  getProviderModelOptions,
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../server/modelProviders/registry";
import { api } from "../utils/api";

type SelectOption = { value: string; label: string };

export type ExtraHeader = { key: string; value: string; concealed?: boolean };

export type UseModelProviderFormParams = {
  provider: MaybeStoredModelProvider;
  projectId: string | undefined;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
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
  isSaving: boolean;
  isToggling: boolean;
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
  addCustomModelsFromText: (text: string) => void;
  setCustomEmbeddingsModels: (options: SelectOption[]) => void;
  addCustomEmbeddingsFromText: (text: string) => void;
  submit: () => Promise<void>;
};

export function useModelProviderForm(
  params: UseModelProviderFormParams,
): [UseModelProviderFormState, UseModelProviderFormActions] {
  const { provider, projectId, onSuccess, onError } = params;

  const updateMutation = api.modelProvider.update.useMutation();

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  // Track the originally stored keys to switch projections when toggling gateway
  const originalStoredKeysRef = useRef<Record<string, unknown>>(
    (provider.customKeys as Record<string, unknown>) || {},
  );

  const getSchemaShape = (schema: any) => {
    if (schema?.shape) return schema.shape;
    if (schema?._def?.schema) return schema._def.schema.shape;
    return {} as Record<string, any>;
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

  const [useApiGateway, setUseApiGatewayState] = useState<boolean>(
    initialUseApiGateway,
  );

  const displayKeys = useMemo(() => {
    if (provider.provider === "azure") {
      if (useApiGateway) {
        return {
          AZURE_API_GATEWAY_BASE_URL:
            originalSchemaShape.AZURE_API_GATEWAY_BASE_URL,
          AZURE_API_GATEWAY_VERSION:
            originalSchemaShape.AZURE_API_GATEWAY_VERSION,
        } as Record<string, any>;
      }
      return {
        AZURE_OPENAI_API_KEY: originalSchemaShape.AZURE_OPENAI_API_KEY,
        AZURE_OPENAI_ENDPOINT: originalSchemaShape.AZURE_OPENAI_ENDPOINT,
      } as Record<string, any>;
    }
    return originalSchemaShape;
  }, [provider.provider, useApiGateway, originalSchemaShape]);

  const [customKeys, setCustomKeys] = useState<Record<string, string>>(() => {
    const stored = originalStoredKeysRef.current || {};
    const result: Record<string, string> = {};
    Object.keys(displayKeys).forEach((key) => {
      const v = (stored as any)[key];
      result[key] = typeof v === "string" ? v : "";
    });
    return result;
  });

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
    getStoredModelOptions(provider.models ?? undefined, provider.provider, "chat"),
  );
  const [customEmbeddingsModels, setCustomEmbeddingsModels] =
    useState<SelectOption[]>(
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

  const [isSaving, setIsSaving] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [errors, setErrors] = useState<{ customKeysRoot?: string }>({});

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
    [onSuccess, onError, provider.id, provider.provider, provider.customKeys, provider.models, provider.embeddingsModels, projectId, updateMutation],
  );

  const setUseApiGateway = useCallback(
    (use: boolean) => {
      setUseApiGatewayState(use);
      if (provider.provider === "azure" && use && extraHeaders.length === 0) {
        setExtraHeaders([{ key: "api-key", value: "", concealed: false }]);
      }
      // Keep existing customKeys; the visible keys are filtered by displayKeys
    },
    [provider.provider, extraHeaders.length],
  );

  const setCustomKey = useCallback((key: string, value: string) => {
    setCustomKeys((prev) => ({ ...prev, [key]: value }));
  }, []);

  const addExtraHeader = useCallback(() => {
    setExtraHeaders((prev) => [...prev, { key: "", value: "", concealed: false }]);
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
    setExtraHeaders((prev) => prev.map((h, i) => (i === index ? { ...h, key } : h)));
  }, []);

  const setExtraHeaderValue = useCallback((index: number, value: string) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, value } : h)),
    );
  }, []);

  const addFromCommaText = (text: string, current: SelectOption[]): SelectOption[] => {
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
        setErrors({ customKeysRoot: parsed.error?.message });
        setIsSaving(false);
        return;
      }

      // Build custom keys to send (merge azure headers when applicable)
      let customKeysToSend: Record<string, unknown> = { ...customKeys };
      if (provider.provider === "azure") {
        const headerMap: Record<string, string> = {};
        (extraHeaders ?? []).forEach((header) => {
          if (header.key.trim() && header.value.trim()) {
            const sanitizedKey = header.key.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
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
        enabled,
        customKeys: customKeysToSend,
        customModels: (customModels ?? []).map((m) => m.value),
        customEmbeddingsModels: (customEmbeddingsModels ?? []).map((m) => m.value),
        extraHeaders: extraHeadersToSend,
      });

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
  }, [customKeys, customModels, customEmbeddingsModels, enabled, extraHeaders, onError, onSuccess, projectId, providerDefinition?.keysSchema, provider.id, provider.provider, updateMutation]);

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
      isSaving,
      isToggling,
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
      addCustomModelsFromText,
      setCustomEmbeddingsModels,
      addCustomEmbeddingsFromText,
      submit,
    },
  ];
}


