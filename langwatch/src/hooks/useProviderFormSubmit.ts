import { useCallback, useState } from "react";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { toaster } from "../components/ui/toaster";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import {
  modelProviders,
  type MaybeStoredModelProvider,
} from "../server/modelProviders/registry";
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
  /** Human-readable label the user typed (or the humanized default). */
  name: string;
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
  /**
   * Multi-scope selection (iter 109). When present this is the
   * canonical shape the tRPC layer consumes; `scopeType`/`scopeId`
   * remain for transitional compat.
   */
  scopes?: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
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
  // B3 redesign: the user's onboarding picks for the three role models
  // need to win over the additive seed (which fills in the registry
  // flagship). After the provider create lands, we replay those picks
  // through `setRoleAssignmentForScope` at every scope the provider
  // covers so the new ModelDefault table reflects what the user chose
  // rather than what the seed defaulted to.
  const setRoleAssignmentMutation =
    api.modelProvider.setRoleAssignmentForScope.useMutation();

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
          error: err,
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
      name,
      scopes,
      scopeType,
      scopeId,
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

      // Block save when "use as default provider" is enabled but the
      // selected default model belongs to a different provider — otherwise
      // the setRoleAssignmentForScope replay below would silently persist
      // a contradiction (this provider becomes the default while the
      // model still points elsewhere). See #3785.
      if (useAsDefaultProvider) {
        const prefix = `${provider.provider}/`;
        const mismatched: string[] = [];
        if (projectDefaultModel && !projectDefaultModel.startsWith(prefix)) {
          mismatched.push("Default model");
        }
        if (
          projectTopicClusteringModel &&
          !projectTopicClusteringModel.startsWith(prefix)
        ) {
          mismatched.push("Topic clustering model");
        }
        if (mismatched.length > 0) {
          const providerDisplayName =
            modelProviders[provider.provider as keyof typeof modelProviders]
              ?.name ?? provider.provider;
          toaster.create({
            title:
              mismatched.length === 1
                ? `Cannot save: ${mismatched[0]?.toLowerCase()} is invalid`
                : "Cannot save: default models are invalid",
            description: `${mismatched.join(" and ")} ${
              mismatched.length === 1 ? "belongs" : "belong"
            } to a different provider. Pick a model from ${providerDisplayName}${
              provider.provider === "azure" ? " (or add a custom deployment)" : ""
            } before saving.`,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
          setIsSaving(false);
          return;
        }
      }

      // Determine what customKeys to send
      let customKeysToSend: Record<string, unknown> | undefined;
      const userEnteredNewKey = hasUserEnteredNewApiKey(customKeys);
      if (!isUsingEnvVars) {
        // Strip any masked placeholder values — they appear when the provider
        // was configured via env vars in a prior session and the user opened
        // the drawer without editing. Submitting the placeholder string would
        // fail backend validation; omitting it preserves the existing key.
        customKeysToSend = filterMaskedApiKeys(customKeys);
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

      const trimmedName = (name ?? "").trim();
      await updateMutation.mutateAsync({
        id: provider.id,
        projectId: projectId ?? "",
        provider: provider.provider,
        name: trimmedName === "" ? undefined : trimmedName,
        enabled: true,
        customKeys: customKeysToSend,
        customModels,
        customEmbeddingsModels,
        extraHeaders: extraHeadersToSend,
        // Send the full scope array when it's populated; the router
        // falls back to legacy scopeType/scopeId for callers still
        // writing through the single-tier path.
        scopes: scopes && scopes.length > 0 ? scopes : undefined,
        scopeType,
        scopeId,
      });

      // Project default models are no longer written from the provider
      // drawer — the redesigned DefaultModelsSection on the model-providers
      // settings page owns hierarchical default-model writes per scope.
      // See specs/model-providers/hierarchical-default-models.feature.

      // Replay the onboarding picks into ModelDefault. Mario's additive
      // seed in `updateModelProvider` already wrote the registry flagship
      // for each role at every scope this provider covers, but the user
      // explicitly picked a Default / Topic-clustering / Embeddings
      // model on this drawer — those picks need to win. We call
      // `setRoleAssignmentForScope` (upsert semantics) per scope per
      // role with the user's value. The Fast role is reused for the
      // legacy "topic clustering" field (the feature registry binds
      // `analytics.topic_clustering_llm` to FAST). See
      // specs/model-providers/role-based-default-models.feature.
      if (useAsDefaultProvider) {
        const targetScopes = scopes && scopes.length > 0
          ? scopes
          : scopeType && scopeId
            ? [{ scopeType, scopeId }]
            : [];
        type RoleWrite = {
          label: string;
          promise: Promise<unknown>;
        };
        const writes: RoleWrite[] = [];
        for (const s of targetScopes) {
          if (projectDefaultModel) {
            writes.push({
              label: `Default at ${s.scopeType.toLowerCase()}`,
              promise: setRoleAssignmentMutation.mutateAsync({
                scopeType: s.scopeType,
                scopeId: s.scopeId,
                role: "DEFAULT",
                model: projectDefaultModel,
              }),
            });
          }
          if (projectTopicClusteringModel) {
            writes.push({
              label: `Fast at ${s.scopeType.toLowerCase()}`,
              promise: setRoleAssignmentMutation.mutateAsync({
                scopeType: s.scopeType,
                scopeId: s.scopeId,
                role: "FAST",
                model: projectTopicClusteringModel,
              }),
            });
          }
          if (projectEmbeddingsModel) {
            writes.push({
              label: `Embeddings at ${s.scopeType.toLowerCase()}`,
              promise: setRoleAssignmentMutation.mutateAsync({
                scopeType: s.scopeType,
                scopeId: s.scopeId,
                role: "EMBEDDINGS",
                model: projectEmbeddingsModel,
              }),
            });
          }
        }
        // Best-effort: a single failed scope (e.g. RBAC blocks an org
        // write for a non-admin) shouldn't kill the whole submit — the
        // provider row is already created. But silent allSettled would
        // also hide ALL three role writes failing, leaving the user
        // with a "Model Provider Updated" success toast and an empty
        // cascade. Capture rejections and surface them as a warning.
        const results = await Promise.allSettled(writes.map((w) => w.promise));
        const failed = results
          .map((r, i) => ({ r, label: writes[i]!.label }))
          .filter((x): x is { r: PromiseRejectedResult; label: string } =>
            x.r.status === "rejected",
          );
        if (failed.length > 0) {
          const reasons = failed
            .map(
              (f) =>
                `${f.label}: ${
                  f.r.reason instanceof Error
                    ? f.r.reason.message
                    : String(f.r.reason)
                }`,
            )
            .join("; ");
          toaster.create({
            title:
              failed.length === writes.length
                ? "Default model assignments failed"
                : "Some default model assignments failed",
            description: reasons,
            type: "warning",
            duration: 8000,
            meta: { closable: true },
          });
        }
      }

      // Invalidate every cached provider/resolved-default query so the
      // prompts page, evaluation wizard, and any other surface that
      // gates UI on "are there enabled providers?" picks up the new
      // state without needing a window-focus refetch. getDefaultModelsForProject
      // is in this unconditional list because the server's first-provider
      // auto-seed (seedOnboardingDefaultsForProvider) runs regardless of
      // the "use as default provider" checkbox — so the DefaultModelsSection
      // card needs to refetch even when the user didn't opt into the replay.
      await Promise.all([
        utils.modelProvider.getAllForProject.invalidate(),
        utils.modelProvider.getAllForProjectForFrontend.invalidate(),
        utils.modelProvider.listAllForProjectForFrontend.invalidate(),
        utils.modelProvider.getResolvedDefault.invalidate(),
        utils.modelProvider.getDefaultModelsForProject.invalidate(),
      ]);

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
        error: err,
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    getFormSnapshot,
    onSuccess,
    onError,
    updateMutation,
    setRoleAssignmentMutation,
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
