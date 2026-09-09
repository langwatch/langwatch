import { useCallback, useState } from "react";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import {
  modelProviders,
  type ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";
import { describeError } from "@langwatch/ui-host/errors";

import {
  useModelProviderToaster,
  useShowErrorToast,
  type ModelProviderToast,
} from "./model-provider-feedback.ts";
import type { CustomModelEntry } from "@langwatch/model-provider-contract";
import { api } from "./model-provider-api.ts";
import {
  filterMaskedApiKeys,
  hasUserEnteredNewApiKey,
  hasUserModifiedAnyCredential,
  hasUserModifiedNonApiKeyFields,
} from "../model/model-provider-helpers.ts";
import {
  broadcastModelProvidersUpdated,
  invalidateModelProviderQueries,
} from "./model-provider-sync.ts";
import type { ExtraHeader } from "./use-extra-headers.ts";

/** Snapshot of all form state needed at submission time. */
export type FormSnapshot = {
  provider: MaybeStoredModelProvider;
  /** Human-readable label the user typed (or the humanized default). */
  name: string;
  /**
   * The slug that addresses this instance in a gateway model string. Empty
   * means the operator wants no handle, which is a real choice: it releases
   * the name for another provider in the organization.
   */
  routingHandle: string;
  /**
   * Tenant anchor for the write. A provider belongs to an organization and reaches the scopes
   * attached to it, so the organization is always the answer and the project is the narrower
   * handle when there is one.
   */
  projectId: string | undefined;
  organizationId: string | undefined;
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

export type UseProviderFormSubmitReturn = UseProviderFormSubmitState & UseProviderFormSubmitActions;

/**
 * What the drawer's Advanced section adds to the update payload.
 *
 * Two independent halves, because two independent audiences own them. The
 * `gateway` half is null when the AI Gateway section is not rendered, so a
 * save never clears rate limits the operator cannot see; the
 * skip-permissions half is undefined when its field is not rendered, and an
 * empty array when the operator cleared it.
 */
export type AdvancedGatewayPayload = {
  gateway: {
    rateLimitRpm: number | null;
    rateLimitTpm: number | null;
    rateLimitRpd: number | null;
    fallbackPriorityGlobal: number | null;
    providerConfig: Record<string, unknown> | null;
  } | null;
  langySkipPermissionsModels?: string[];
};

type ProviderScope = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };

/** The router falls back to legacy scopeType/scopeId when the array is empty. */
function optionalScopes(scopes: ProviderScope[] | undefined): ProviderScope[] | undefined {
  return scopes && scopes.length > 0 ? scopes : undefined;
}

/** Empty is how the operator clears a name, and the server reads absence for that. */
function nameToSend(name: string | undefined): string | undefined {
  const trimmed = (name ?? "").trim();

  return trimmed === "" ? undefined : trimmed;
}

/** Non-API-key fields (a base URL, say) edited while the credentials come from the environment. */
function hasNonApiKeyEdits({
  customKeys,
  initialKeys,
  isUsingEnvVars,
}: {
  customKeys: Record<string, string>;
  initialKeys: Record<string, unknown>;
  isUsingEnvVars: boolean | undefined;
}): boolean {
  if (!isUsingEnvVars) return false;

  return hasUserModifiedNonApiKeyFields(customKeys, initialKeys);
}

/**
 * The credential refusal in the words zod chose, or null when the keys parse.
 * Environment-variable credentials skip the check unless a non-API-key field
 * (a base URL, say) was edited.
 */
function findCustomKeysRefusal({
  customKeys,
  hasNonApiKeyChanges,
  isUsingEnvVars,
  providerKeysSchema,
}: {
  customKeys: Record<string, string>;
  hasNonApiKeyChanges: boolean;
  isUsingEnvVars: boolean | undefined;
  providerKeysSchema: unknown;
}): string | null {
  const mustValidate = !isUsingEnvVars || hasNonApiKeyChanges;
  if (!mustValidate) return null;

  const managedOnly = z.object({ MANAGED: z.string() }).optional().nullable();
  const keysSchema = providerKeysSchema
    ? z
        .union([providerKeysSchema as z.ZodTypeAny, z.object({ MANAGED: z.string() })])
        .optional()
        .nullable()
    : managedOnly;
  const keysToValidate: Record<string, unknown> = { ...customKeys };
  const parsed = (keysSchema as any).safeParse
    ? (keysSchema as any).safeParse(keysToValidate)
    : { success: true };
  if (parsed.success) return null;

  return fromZodError(parsed.error as ZodError).message;
}

/**
 * Roles whose picked model belongs to another provider. Saving those would
 * persist a contradiction: this provider becomes the default while the model
 * still points elsewhere. See #3785.
 */
function mismatchedDefaultModels({
  projectDefaultModel,
  projectTopicClusteringModel,
  providerKey,
  useAsDefaultProvider,
}: {
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  providerKey: string;
  useAsDefaultProvider: boolean;
}): string[] {
  if (!useAsDefaultProvider) return [];

  const prefix = `${providerKey}/`;
  const mismatched: string[] = [];
  if (projectDefaultModel && !projectDefaultModel.startsWith(prefix)) {
    mismatched.push("Default model");
  }
  if (projectTopicClusteringModel && !projectTopicClusteringModel.startsWith(prefix)) {
    mismatched.push("Topic clustering model");
  }

  return mismatched;
}

function mismatchToast({
  mismatched,
  providerKey,
}: {
  mismatched: string[];
  providerKey: string;
}): ModelProviderToast {
  const providerDisplayName =
    modelProviders[providerKey as keyof typeof modelProviders]?.name ?? providerKey;
  const isSingle = mismatched.length === 1;
  const azureHint = providerKey === "azure" ? " (or add a custom deployment)" : "";
  const verb = isSingle ? "belongs" : "belong";

  return {
    title: isSingle
      ? `Cannot save: ${mismatched[0]?.toLowerCase()} is invalid`
      : "Cannot save: default models are invalid",
    description: `${mismatched.join(" and ")} ${verb} to a different provider. Pick a model from ${providerDisplayName}${azureHint} before saving.`,
    type: "error",
    duration: 5000,
  };
}

/**
 * When editing an existing provider, the stored key is shown masked. Decide
 * whether anything changed by ignoring those placeholders — an untouched key
 * must not count as an edit — but send the form as the customer left it,
 * placeholders included: each one tells the server to keep the credential
 * already on file. An empty object would be validated against the provider's
 * keysSchema, so it becomes absence instead.
 */
function customKeysToSendFor({
  customKeys,
  hasNonApiKeyChanges,
  initialKeys,
  isUsingEnvVars,
}: {
  customKeys: Record<string, string>;
  hasNonApiKeyChanges: boolean;
  initialKeys: Record<string, unknown>;
  isUsingEnvVars: boolean | undefined;
}): Record<string, unknown> | undefined {
  const userEnteredNewKey = hasUserEnteredNewApiKey(customKeys);
  const keys = pickCustomKeys({
    customKeys,
    hasNonApiKeyChanges,
    initialKeys,
    isUsingEnvVars,
    userEnteredNewKey,
  });
  if (keys && Object.keys(keys).length === 0) return undefined;

  return keys;
}

function pickCustomKeys({
  customKeys,
  hasNonApiKeyChanges,
  initialKeys,
  isUsingEnvVars,
  userEnteredNewKey,
}: {
  customKeys: Record<string, string>;
  hasNonApiKeyChanges: boolean;
  initialKeys: Record<string, unknown>;
  isUsingEnvVars: boolean | undefined;
  userEnteredNewKey: boolean;
}): Record<string, unknown> | undefined {
  if (!isUsingEnvVars) {
    const hasRealChange = hasUserModifiedAnyCredential({ customKeys, initialKeys });

    return hasRealChange ? { ...customKeys } : undefined;
  }
  if (!userEnteredNewKey && !hasNonApiKeyChanges) return undefined;

  return userEnteredNewKey ? { ...customKeys } : filterMaskedApiKeys(customKeys);
}

/** The gateway and skip-permissions halves, each present only when its section rendered. */
function advancedFields(payload: AdvancedGatewayPayload | null): Record<string, unknown> {
  return {
    ...(payload?.gateway && {
      rateLimitRpm: payload.gateway.rateLimitRpm,
      rateLimitTpm: payload.gateway.rateLimitTpm,
      rateLimitRpd: payload.gateway.rateLimitRpd,
      fallbackPriorityGlobal: payload.gateway.fallbackPriorityGlobal,
      providerConfig: payload.gateway.providerConfig,
    }),
    ...(payload?.langySkipPermissionsModels !== undefined && {
      langySkipPermissionsModels: payload.langySkipPermissionsModels,
    }),
  };
}

/**
 * Malformed JSON in providerConfig raises here; the parent form already
 * surfaces the inline error, so the submit aborts on a refusal.
 */
function readAdvancedPayload(
  getAdvancedPayload: (() => AdvancedGatewayPayload | null) | undefined,
): { payload: AdvancedGatewayPayload | null; refusal?: unknown } {
  if (!getAdvancedPayload) return { payload: null };

  try {
    return { payload: getAdvancedPayload() };
  } catch (err) {
    return { payload: null, refusal: err };
  }
}

function replayTargetScopes({
  scopeId,
  scopeType,
  scopes,
}: {
  scopeId?: string;
  scopeType?: ProviderScope["scopeType"];
  scopes?: ProviderScope[];
}): ProviderScope[] {
  const explicit = optionalScopes(scopes);
  if (explicit) return explicit;
  if (scopeType && scopeId) return [{ scopeType, scopeId }];

  return [];
}

type RoleWrite = { label: string; promise: Promise<unknown> };

/**
 * The onboarding picks replayed into ModelDefault. The additive seed in
 * `updateModelProvider` already wrote the registry flagship for each role at
 * every scope this provider covers; the picks made on this drawer must win.
 */
function roleWrites({
  assign,
  projectDefaultModel,
  projectEmbeddingsModel,
  projectTopicClusteringModel,
  targetScopes,
}: {
  assign: (input: {
    scopeType: ProviderScope["scopeType"];
    scopeId: string;
    role: "DEFAULT" | "FAST" | "EMBEDDINGS";
    model: string;
  }) => Promise<unknown>;
  projectDefaultModel: string | null;
  projectEmbeddingsModel: string | null;
  projectTopicClusteringModel: string | null;
  targetScopes: ProviderScope[];
}): RoleWrite[] {
  const roles: Array<{
    label: string;
    model: string | null;
    role: "DEFAULT" | "FAST" | "EMBEDDINGS";
  }> = [
    { label: "Default", model: projectDefaultModel, role: "DEFAULT" },
    { label: "Fast", model: projectTopicClusteringModel, role: "FAST" },
    { label: "Embeddings", model: projectEmbeddingsModel, role: "EMBEDDINGS" },
  ];

  const writes: RoleWrite[] = [];
  for (const scope of targetScopes) {
    for (const { label, model, role } of roles) {
      if (!model) continue;

      writes.push({
        label: `${label} at ${scope.scopeType.toLowerCase()}`,
        promise: assign({ scopeType: scope.scopeType, scopeId: scope.scopeId, role, model }),
      });
    }
  }

  return writes;
}

/**
 * Best-effort: a single failed scope (RBAC blocking an org write for a
 * non-admin, say) must not kill a submit whose provider row already landed.
 * A silent allSettled would also hide ALL three role writes failing, leaving
 * a success toast over an empty cascade, so the rejections come back as a
 * warning naming which role failed and why. A tRPC rejection's message is the
 * code slug, so `describeError` supplies the copy written for that code.
 */
async function reportRoleWriteFailures(writes: RoleWrite[]): Promise<ModelProviderToast | null> {
  const results = await Promise.allSettled(writes.map((w) => w.promise));
  const failed = results
    .map((r, i) => ({ r, label: writes[i]!.label }))
    .filter((x): x is { r: PromiseRejectedResult; label: string } => x.r.status === "rejected");
  if (failed.length === 0) return null;

  const reasons = failed
    .map(
      (f) =>
        `${f.label}: ${describeError({
          error: f.r.reason,
          fallbackTitle: "Couldn't save this default",
        })}`,
    )
    .join("; ");

  return {
    title:
      failed.length === writes.length
        ? "Default model assignments failed"
        : "Some default model assignments failed",
    description: reasons,
    type: "warning",
    duration: 8000,
  };
}

export function useProviderFormSubmit({
  getFormSnapshot,
  getAdvancedPayload,
  onSuccess,
  onError,
}: {
  getFormSnapshot: () => FormSnapshot;
  /**
   * Returns the parsed advanced (gateway) fields to send in the same `update` round-trip, or
   * `null` to skip.
   */
  getAdvancedPayload?: () => AdvancedGatewayPayload | null;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}): UseProviderFormSubmitReturn {
  const utils = api.useUtils();
  const toaster = useModelProviderToaster();
  const showErrorToast = useShowErrorToast();
  const updateMutation = api.modelProvider.update.useMutation();
  // B3 redesign: the user's onboarding picks for the three role models need to win over the
  // additive seed (which fills in the registry flagship). After the provider create lands, we
  // replay those picks through `setRoleAssignmentForScope` at every scope the provider covers
  // so the new ModelDefault table reflects what the user chose rather than what the seed
  // defaulted to.
  const setRoleAssignmentMutation = api.modelProvider.setRoleAssignmentForScope.useMutation();

  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<{ customKeysRoot?: string }>({});

  const setEnabled = useCallback(
    async (newEnabled: boolean) => {
      const snapshot = getFormSnapshot();
      try {
        await updateMutation.mutateAsync({
          id: snapshot.provider.id,
          projectId: snapshot.projectId,
          organizationId: snapshot.organizationId,
          provider: snapshot.provider.provider,
          enabled: newEnabled,
          customKeys: snapshot.provider.customKeys as any,
          customModels: snapshot.provider.customModels ?? [],
          customEmbeddingsModels: snapshot.provider.customEmbeddingsModels ?? [],
        });
        await invalidateModelProviderQueries(utils);
        broadcastModelProvidersUpdated();
        onSuccess?.();
      } catch (err) {
        onError?.(err);
        showErrorToast({
          error: err,
          fallbackTitle: "Couldn't update the provider",
        });
      }
    },
    [getFormSnapshot, onSuccess, onError, updateMutation, utils, showErrorToast],
  );

  const submit = useCallback(async () => {
    setIsSaving(true);
    setErrors({});

    const snapshot = getFormSnapshot();
    const {
      provider,
      projectId,
      organizationId,
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
      routingHandle,
      scopes,
      scopeType,
      scopeId,
    } = snapshot;

    try {
      const hasNonApiKeyChanges = hasNonApiKeyEdits({ customKeys, initialKeys, isUsingEnvVars });

      const keysRefusal = findCustomKeysRefusal({
        customKeys,
        hasNonApiKeyChanges,
        isUsingEnvVars,
        providerKeysSchema,
      });
      if (keysRefusal) {
        setErrors({ customKeysRoot: keysRefusal });
        setIsSaving(false);
        return;
      }

      const mismatched = mismatchedDefaultModels({
        projectDefaultModel,
        projectTopicClusteringModel,
        providerKey: provider.provider,
        useAsDefaultProvider,
      });
      if (mismatched.length > 0) {
        toaster.create(mismatchToast({ mismatched, providerKey: provider.provider }));
        setIsSaving(false);
        return;
      }

      const customKeysToSend = customKeysToSendFor({
        customKeys,
        hasNonApiKeyChanges,
        initialKeys,
        isUsingEnvVars,
      });

      // Headers are not credentials. They have their own column, their own masked-placeholder
      // merge (`mergeExtraHeaders`), and both readers take them from there:
      // `prepareLitellmParams` builds `extra_headers` from `modelProvider.extraHeaders`, and
      // the gateway materialiser reads `mp.extraHeaders`.
      const extraHeadersToSend = (extraHeaders ?? [])
        .filter((h) => h.key?.trim())
        .map(({ key, value }) => ({ key, value }));

      const advanced = readAdvancedPayload(getAdvancedPayload);
      if (advanced.refusal) {
        setIsSaving(false);
        onError?.(advanced.refusal);
        return;
      }

      await updateMutation.mutateAsync({
        id: provider.id,
        projectId,
        organizationId,
        provider: provider.provider,
        name: nameToSend(name),
        // Always sent, because an empty string is how the operator clears the
        // handle. Leaving it out on a clear would keep the old one.
        routingHandle: (routingHandle ?? "").trim(),
        enabled: true,
        customKeys: customKeysToSend,
        customModels,
        customEmbeddingsModels,
        extraHeaders: extraHeadersToSend,
        scopes: optionalScopes(scopes),
        scopeType,
        scopeId,
        ...advancedFields(advanced.payload),
      });

      // Project default models are no longer written from the provider
      // drawer — the redesigned DefaultModelsSection on the model-providers
      // settings page owns hierarchical default-model writes per scope.
      // See specs/model-providers/hierarchical-default-models.feature.
      if (useAsDefaultProvider) {
        const failureToast = await reportRoleWriteFailures(
          roleWrites({
            assign: (input) => setRoleAssignmentMutation.mutateAsync(input),
            projectDefaultModel,
            projectEmbeddingsModel,
            projectTopicClusteringModel,
            targetScopes: replayTargetScopes({ scopeId, scopeType, scopes }),
          }),
        );
        if (failureToast) toaster.create(failureToast);
      }

      // Invalidate every cached provider/resolved-default query so the prompts page, evaluation
      // wizard, and any other surface that gates UI on "are there enabled providers?" picks up
      // the new state without needing a window-focus refetch.
      await invalidateModelProviderQueries(utils);
      // This save may have happened in a tab opened by
      // NoModelsConfiguredCallout's "Set up" link — broadcast so the
      // opener tab's picker (a different QueryClient instance) refreshes
      // immediately instead of waiting on a window-focus event that,
      // for a window.open'd tab pair, often never reliably fires (#5827).
      broadcastModelProvidersUpdated();

      toaster.create({
        title: "Model Provider Updated",
        type: "success",
        duration: 3000,
      });
      onSuccess?.();
    } catch (err) {
      onError?.(err);
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't save the provider settings",
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    getFormSnapshot,
    getAdvancedPayload,
    onSuccess,
    onError,
    updateMutation,
    setRoleAssignmentMutation,
    utils,
    toaster,
    showErrorToast,
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
