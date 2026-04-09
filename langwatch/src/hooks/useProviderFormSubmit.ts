import { useCallback, useState } from "react";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { toaster } from "../components/ui/toaster";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { api } from "../utils/api";
import {
  filterMaskedApiKeys,
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
} from "../utils/modelProviderHelpers";
import type { ExtraHeader } from "./useExtraHeaders";

/** Snapshot of all form state needed at submission time. */
export type FormSnapshot = {
  provider: MaybeStoredModelProvider;
  projectId: string | undefined;
  isUsingEnvVars: boolean | undefined;
  customKeys: Record<string, string>;
  initialKeys: Record<string, unknown>;
  providerKeysSchema: unknown;
  extraHeaders: ExtraHeader[];
  customModels: CustomModelEntry[];
  customEmbeddingsModels: CustomModelEntry[];
  useAsDefaultProvider: boolean;
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  projectEmbeddingsModel: string | null;
};

export type UseProviderFormSubmitState = {
  isSaving: boolean;
  errors: {
    customKeysRoot?: string;
  };
};

export type UseProviderFormSubmitActions = {
  submit: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  reset: () => void;
};

export type UseProviderFormSubmitReturn = UseProviderFormSubmitState &
  UseProviderFormSubmitActions;

export function useProviderFormSubmit({
  getFormSnapshot,
  onSuccess,
  onError,
}: {
  getFormSnapshot: () => FormSnapshot;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}): UseProviderFormSubmitReturn {
  const utils = api.useContext();
  const updateMutation = api.modelProvider.update.useMutation();
  const updateProjectDefaultModelsMutation =
    api.project.updateProjectDefaultModels.useMutation();

  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ customKeysRoot?: string }>({});

  const setEnabled = useCallback(
    async (newEnabled: boolean) => {
      const snapshot = getFormSnapshot();
      try {
        await updateMutation.mutateAsync({
          id: snapshot.provider.id,
          projectId: snapshot.projectId ?? "",
          provider: snapshot.provider.provider,
          enabled: newEnabled,
          customKeys: snapshot.provider.customKeys as any,
          customModels: snapshot.provider.customModels ?? [],
          customEmbeddingsModels:
            snapshot.provider.customEmbeddingsModels ?? [],
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
    [getFormSnapshot, onSuccess, onError, updateMutation],
  );

  const submit = useCallback(async () => {
    setIsSaving(true);
    setErrors({});

    const snapshot = getFormSnapshot();
    const {
      provider,
      projectId,
      isUsingEnvVars,
      customKeys,
      initialKeys,
      providerKeysSchema,
      extraHeaders,
      customModels,
      customEmbeddingsModels,
      useAsDefaultProvider,
      projectDefaultModel,
      projectTopicClusteringModel,
      projectEmbeddingsModel,
    } = snapshot;

    try {
      // Check if user modified non-API-key fields (like URLs) when using env vars
      const hasNonApiKeyChanges =
        isUsingEnvVars &&
        hasUserModifiedNonApiKeyFields(customKeys, initialKeys);

      // Validate if not using env vars, OR if using env vars but has non-API-key changes
      if (!isUsingEnvVars || hasNonApiKeyChanges) {
        const keysSchema = providerKeysSchema
          ? z
              .union([
                providerKeysSchema as z.ZodTypeAny,
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

      // Determine what customKeys to send
      let customKeysToSend: Record<string, unknown> | undefined;
      const userEnteredNewKey = hasUserEnteredNewApiKey(customKeys);
      if (!isUsingEnvVars) {
        customKeysToSend = { ...customKeys };
      } else if (userEnteredNewKey || hasNonApiKeyChanges) {
        customKeysToSend = userEnteredNewKey
          ? { ...customKeys }
          : filterMaskedApiKeys(customKeys);
      } else {
        customKeysToSend = undefined;
      }

      // Merge azure headers when applicable
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
        enabled: true,
        customKeys: customKeysToSend,
        customModels,
        customEmbeddingsModels,
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
    getFormSnapshot,
    onSuccess,
    onError,
    updateMutation,
    updateProjectDefaultModelsMutation,
    utils,
  ]);

  const reset = useCallback(() => {
    setErrors({});
    setIsSaving(false);
  }, []);

  return {
    isSaving,
    errors,
    submit,
    setEnabled,
    reset,
  };
}
