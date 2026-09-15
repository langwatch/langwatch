import { useCallback, useEffect, useMemo, useState } from "react";
import {
  modelProviders as modelProvidersRegistry,
  type ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";
import type { CustomModelEntry } from "@langwatch/model-provider-contract";
import { hasUserModifiedAnyCredential, headerSignature } from "../model/model-provider-helpers.ts";

// Mirrors the server's deriveDefaultName. Kept here so the drawer can
// pre-fill the input on open without an extra tRPC round trip.
function humanizeProviderName(providerKey: string): string {
  const def = modelProvidersRegistry[providerKey as keyof typeof modelProvidersRegistry];
  if (def?.name) return def.name;
  return providerKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

import { computeInitialUseApiGateway, useCredentialKeys } from "./use-credential-keys.ts";
import { useCustomModels } from "./use-custom-models.ts";
import { useDefaultProviderSelection } from "./use-default-provider-selection.ts";
import { type ExtraHeader, useExtraHeaders } from "./use-extra-headers.ts";
import {
  type AdvancedGatewayPayload,
  type FormSnapshot,
  useProviderFormSubmit,
} from "./use-provider-form-submit.ts";

export type ModelProviderScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export type ScopeSelection = {
  scopeType: ModelProviderScopeType;
  scopeId: string;
};

export type UseModelProviderFormParams = {
  provider: MaybeStoredModelProvider;
  projectId: string | undefined;
  enabledProvidersCount: number;
  isUsingEnvVars?: boolean;
  // Principal-style scope context (iter 108). The team+org IDs come from
  // useOrganizationTeamProject so the form can render the picker and derive
  // the scopeId for ORGANIZATION/TEAM selections. Legacy PROJECT scope
  // keeps working when these are undefined.
  teamId?: string;
  organizationId?: string;
  /**
   * Permission predicates used to decide the default scope selection for
   * a brand-new provider (iter 109). The form opens at the widest scope
   * the user can manage: ORGANIZATION if they have organization:manage,
   * else TEAM if they have team:manage, else PROJECT. Callers wire these
   * from useOrganizationTeamProject's hasPermission helper.
   */
  canManageOrganization?: boolean;
  canManageTeam?: boolean;
  /**
   * Optional advanced-gateway payload callback used by the unified
   * Save. The drawer wires this when the AI Gateway feature flag is
   * on for the caller's org; throwing (malformed JSON) aborts submit
   * so the parent can render the inline parse error.
   */
  getAdvancedPayload?: () => AdvancedGatewayPayload | null;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

export type UseModelProviderFormState = {
  /**
   * User-facing name. Defaults to the humanized provider string
   * ("openai" → "OpenAI"); operators override it when they run
   * multiple instances of the same provider at different scopes
   * so the list and model-selector groups stay distinguishable.
   */
  name: string;
  /**
   * The slug that addresses this instance in a gateway model string
   * ("eu/claude-sonnet-5"). Empty when the operator set none, in which case
   * the provider is reached by its family prefix like any other.
   */
  routingHandle: string;
  useApiGateway: boolean;
  customKeys: Record<string, string>;
  displayKeys: Record<string, any>;
  initialKeys: Record<string, unknown>;
  extraHeaders: ExtraHeader[];
  customModels: CustomModelEntry[];
  customEmbeddingsModels: CustomModelEntry[];
  useAsDefaultProvider: boolean;
  projectDefaultModel: string | null;
  projectTopicClusteringModel: string | null;
  projectEmbeddingsModel: string | null;
  /**
   * Multi-scope selection (iter 109). Every write sends this array to
   * the tRPC layer and the service fail-closes the whole write if any
   * single scope is unmanageable by the caller. For backwards-compat
   * reads, `scopeType` still exposes the narrowest entry's tier.
   */
  scopes: ScopeSelection[];
  /** Narrowest scope tier from `scopes` — kept for the legacy picker. */
  scopeType: ModelProviderScopeType;
  isSaving: boolean;
  errors: {
    customKeysRoot?: string;
  };
  /**
   * True when any user-editable form field differs from the loaded
   * provider's initial values. Drives the Save button's disabled state
   * so a drawer opened-and-immediately-saved no-op stays out of the
   * mutation path entirely (and never produces a misleading "Updated"
   * toast). Advanced (Gateway) fields live outside this hook, so the
   * parent form ORs in its own advanced-draft dirty signal.
   */
  isDirty: boolean;
};

export type UseModelProviderFormActions = {
  setEnabled: (enabled: boolean) => Promise<void>;
  setName: (name: string) => void;
  setRoutingHandle: (routingHandle: string) => void;
  setScopes: (scopes: ScopeSelection[]) => void;
  setScopeType: (scope: ModelProviderScopeType) => void;
  setUseApiGateway: (use: boolean) => void;
  setCustomKey: (key: string, value: string) => void;
  addExtraHeader: () => void;
  removeExtraHeader: (index: number) => void;
  toggleExtraHeaderConcealed: (index: number) => void;
  setExtraHeaderKey: (index: number, key: string) => void;
  setExtraHeaderValue: (index: number, value: string) => void;
  addCustomModel: (entry: CustomModelEntry) => void;
  removeCustomModel: (modelId: string) => void;
  setCustomModels: (models: CustomModelEntry[]) => void;
  addCustomEmbeddingsModel: (entry: CustomModelEntry) => void;
  removeCustomEmbeddingsModel: (modelId: string) => void;
  setUseAsDefaultProvider: (use: boolean) => void;
  setProjectDefaultModel: (model: string | null) => void;
  setProjectTopicClusteringModel: (model: string | null) => void;
  setProjectEmbeddingsModel: (model: string | null) => void;
  setManaged: (managed: boolean) => void;
  submit: () => Promise<void>;
};

/**
 * A brand-new provider opens at the widest scope the user can manage
 * (organization > team > project), so an admin lands on the most useful
 * default instead of flipping from PROJECT every time.
 */
function widestManageableScope({
  canManageOrganization,
  canManageTeam,
  organizationId,
  projectId,
  teamId,
}: {
  canManageOrganization?: boolean;
  canManageTeam?: boolean;
  organizationId?: string;
  projectId?: string;
  teamId?: string;
}): { scopeType: ModelProviderScopeType; scopeId: string | undefined } {
  if (canManageOrganization && organizationId) {
    return { scopeType: "ORGANIZATION", scopeId: organizationId };
  }
  if (canManageTeam && teamId) return { scopeType: "TEAM", scopeId: teamId };

  return { scopeType: "PROJECT", scopeId: projectId };
}

function scopeIdForTier(
  tier: ModelProviderScopeType,
  handles: { organizationId?: string; projectId?: string; teamId?: string },
): string | undefined {
  if (tier === "ORGANIZATION") return handles.organizationId;
  if (tier === "TEAM") return handles.teamId;

  return handles.projectId;
}

/** The scopes stored on the provider, in the array shape iter 109 made canonical. */
function storedScopesOf(provider: MaybeStoredModelProvider): ScopeSelection[] {
  const stored = provider.scopes;
  if (stored && stored.length > 0) {
    return stored.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId }));
  }

  const { scopeId, scopeType } = provider;
  if (scopeType && scopeId) return [{ scopeType, scopeId }];

  return [];
}

function initialScopesFor({
  defaultScope,
  provider,
}: {
  defaultScope: { scopeType: ModelProviderScopeType; scopeId: string | undefined };
  provider: MaybeStoredModelProvider;
}): ScopeSelection[] {
  const stored = storedScopesOf(provider);
  if (stored.length > 0) return stored;
  if (!defaultScope.scopeId) return [];

  return [{ scopeType: defaultScope.scopeType, scopeId: defaultScope.scopeId }];
}

/**
 * Narrowest tier (PROJECT > TEAM > ORGANIZATION): legacy consumers that
 * expected a single `scopeType` pick the most specific one.
 */
function narrowestScopeType(
  scopes: ScopeSelection[],
  fallback: ModelProviderScopeType,
): ModelProviderScopeType {
  const tiers: ModelProviderScopeType[] = ["PROJECT", "TEAM"];
  const found = tiers.find((tier) => scopes.some((s) => s.scopeType === tier));

  return found ?? scopes[0]?.scopeType ?? fallback;
}

/** Order-insensitive: two scopes added in a different order are not a change. */
function scopeSignature(scopes: { scopeType: string; scopeId: string }[]): string {
  return scopes
    .map((s) => `${s.scopeType}|${s.scopeId}`)
    .sort()
    .join(",");
}

function jsonSignature(value: unknown): string {
  return JSON.stringify(value ?? []);
}

/**
 * Dirty detection drives the Save button. Compared per-field so the helpers
 * that already know about MASKED_KEY_PLACEHOLDER are reused — a naive
 * JSON.stringify of customKeys would always look dirty, because the form
 * shows the masked sentinel while the stored value is the real key. Headers
 * compare on key and value only: the form carries a `concealed` flag the
 * stored header knows nothing about.
 */
function hasUnsavedChanges({
  customEmbeddingsModels,
  customKeys,
  customModels,
  extraHeaders,
  initialKeys,
  name,
  provider,
  routingHandle,
  scopes,
  useApiGateway,
}: {
  customEmbeddingsModels: CustomModelEntry[];
  customKeys: Record<string, string>;
  customModels: CustomModelEntry[];
  extraHeaders: ExtraHeader[];
  initialKeys: Record<string, unknown>;
  name: string;
  provider: MaybeStoredModelProvider;
  routingHandle: string;
  scopes: ScopeSelection[];
  useApiGateway: boolean;
}): boolean {
  const storedName =
    (provider as { name?: string }).name ?? humanizeProviderName(provider.provider);
  const nameChanged = name.trim() !== storedName.trim();
  if (nameChanged) return true;

  const storedHandle = (provider as { routingHandle?: string | null }).routingHandle ?? "";
  const handleChanged = routingHandle.trim().toLowerCase() !== storedHandle;
  if (handleChanged) return true;

  // The same helper the submit path uses to decide whether to send
  // credentials at all, so the button and the payload cannot disagree.
  // Emptying a key field is a change too: reading only "a new api key was
  // typed" left removing a credential impossible.
  const credentialsEdited = hasUserModifiedAnyCredential({ customKeys, initialKeys });
  if (credentialsEdited) return true;
  if (useApiGateway !== computeInitialUseApiGateway(provider)) return true;

  const scopesChanged = scopeSignature(scopes) !== scopeSignature(storedScopesOf(provider));
  if (scopesChanged) return true;

  // Headers and models: order-sensitive compare. Reordering a list counts as
  // dirty, which matches user intent — the user dragged them on purpose.
  const headersChanged = headerSignature(extraHeaders) !== headerSignature(provider.extraHeaders);
  if (headersChanged) return true;

  const stored = provider as { customModels?: unknown; customEmbeddingsModels?: unknown };
  const modelsChanged = jsonSignature(customModels) !== jsonSignature(stored.customModels);
  if (modelsChanged) return true;

  return jsonSignature(customEmbeddingsModels) !== jsonSignature(stored.customEmbeddingsModels);
}

export function useModelProviderForm(
  params: UseModelProviderFormParams,
): [UseModelProviderFormState, UseModelProviderFormActions] {
  const {
    provider,
    projectId,
    enabledProvidersCount,
    isUsingEnvVars,
    teamId,
    organizationId,
    canManageOrganization,
    canManageTeam,
    getAdvancedPayload,
    onSuccess,
    onError,
  } = params;

  // Name state — editing an existing row shows the stored name, new
  // rows pre-fill with the humanized provider default so the input
  // never looks empty.
  const initialName =
    (provider as { name?: string }).name ?? humanizeProviderName(provider.provider);
  const [name, setName] = useState<string>(initialName);

  // Routing handle — stored lowercased, so the input shows what the gateway
  // will actually answer to rather than what was typed.
  const initialRoutingHandle = (provider as { routingHandle?: string | null }).routingHandle ?? "";
  const [routingHandle, setRoutingHandle] = useState<string>(initialRoutingHandle);

  // Scope state — defaults to the stored provider's scope set when editing.
  // Iter 109 made this an array; callers that expect a single tier still work
  // through the derived `scopeType`.
  const defaultScope = widestManageableScope({
    canManageOrganization,
    canManageTeam,
    organizationId,
    projectId,
    teamId,
  });

  const [scopes, setScopes] = useState<ScopeSelection[]>(() =>
    initialScopesFor({ defaultScope, provider }),
  );

  const scopeType = narrowestScopeType(scopes, defaultScope.scopeType);
  const scopeId = scopes.find((s) => s.scopeType === scopeType)?.scopeId ?? undefined;

  const setScopeType = useCallback(
    (next: ModelProviderScopeType) => {
      const nextId = scopeIdForTier(next, { organizationId, projectId, teamId });
      if (!nextId) return;
      setScopes([{ scopeType: next, scopeId: nextId }]);
    },
    [organizationId, teamId, projectId],
  );

  // --- Sub-hooks ---
  const credentialKeysHook = useCredentialKeys({ provider });
  const extraHeadersHook = useExtraHeaders({ provider });
  const customModelsHook = useCustomModels({ provider });
  const defaultProviderHook = useDefaultProviderSelection({
    provider,
    enabledProvidersCount,
  });

  // Build snapshot callback for submit (avoids stale closures)
  const getFormSnapshot = useCallback(
    (): FormSnapshot => ({
      provider,
      projectId,
      organizationId,
      isUsingEnvVars,
      customKeys: credentialKeysHook.customKeys,
      initialKeys: credentialKeysHook.originalStoredKeysRef.current,
      providerKeysSchema: credentialKeysHook.providerDefinition?.keysSchema,
      extraHeaders: extraHeadersHook.extraHeaders,
      customModels: customModelsHook.customModels,
      customEmbeddingsModels: customModelsHook.customEmbeddingsModels,
      useAsDefaultProvider: defaultProviderHook.useAsDefaultProvider,
      projectDefaultModel: defaultProviderHook.projectDefaultModel,
      projectTopicClusteringModel: defaultProviderHook.projectTopicClusteringModel,
      projectEmbeddingsModel: defaultProviderHook.projectEmbeddingsModel,
      name,
      routingHandle,
      scopes,
      scopeType,
      scopeId,
    }),
    [
      provider,
      projectId,
      organizationId,
      isUsingEnvVars,
      credentialKeysHook.customKeys,
      credentialKeysHook.originalStoredKeysRef,
      credentialKeysHook.providerDefinition?.keysSchema,
      extraHeadersHook.extraHeaders,
      customModelsHook.customModels,
      customModelsHook.customEmbeddingsModels,
      defaultProviderHook.useAsDefaultProvider,
      defaultProviderHook.projectDefaultModel,
      defaultProviderHook.projectTopicClusteringModel,
      defaultProviderHook.projectEmbeddingsModel,
      name,
      routingHandle,
      scopes,
      scopeType,
      scopeId,
    ],
  );

  const formSubmitHook = useProviderFormSubmit({
    getFormSnapshot,
    getAdvancedPayload,
    onSuccess,
    onError,
  });

  const isDirty = useMemo(
    () =>
      hasUnsavedChanges({
        customEmbeddingsModels: customModelsHook.customEmbeddingsModels,
        customKeys: credentialKeysHook.customKeys,
        customModels: customModelsHook.customModels,
        extraHeaders: extraHeadersHook.extraHeaders,
        initialKeys: credentialKeysHook.originalStoredKeysRef.current as Record<string, unknown>,
        name,
        provider,
        routingHandle,
        scopes,
        useApiGateway: credentialKeysHook.useApiGateway,
      }),
    [
      provider,
      name,
      routingHandle,
      credentialKeysHook.customKeys,
      credentialKeysHook.originalStoredKeysRef,
      credentialKeysHook.useApiGateway,
      scopes,
      extraHeadersHook.extraHeaders,
      customModelsHook.customModels,
      customModelsHook.customEmbeddingsModels,
    ],
  );

  // --- Cross-hook coordination: gateway toggle wires credential keys → extra headers ---
  const handleGatewayToggle = useCallback(
    (useGateway: boolean) => {
      const needsApiKeyHeader = provider.provider === "azure" && useGateway;
      if (needsApiKeyHeader) extraHeadersHook.ensureApiKeyHeader();
    },
    [provider.provider, extraHeadersHook.ensureApiKeyHeader],
  );

  const setUseApiGateway = useCallback(
    (use: boolean) => {
      credentialKeysHook.setUseApiGateway(use, handleGatewayToggle);
    },
    [credentialKeysHook.setUseApiGateway, handleGatewayToggle],
  );

  // --- Single reset effect ---
  useEffect(() => {
    const nextUseApiGateway = credentialKeysHook.reset(provider);
    extraHeadersHook.reset(provider, nextUseApiGateway);
    customModelsHook.reset(provider);
    defaultProviderHook.reset(provider, enabledProvidersCount);
    formSubmitHook.reset();
    setName((provider as { name?: string }).name ?? humanizeProviderName(provider.provider));
    setRoutingHandle((provider as { routingHandle?: string | null }).routingHandle ?? "");
  }, [
    provider.provider,
    provider.id,
    provider.enabled,
    provider.customKeys,
    provider.customModels,
    provider.customEmbeddingsModels,
    provider.extraHeaders,
    // The reset re-fires when provider mutations propagate; the
    // resolved default models come from
    // `api.modelProvider.getResolvedDefault` at the actual consumer of
    // each role chip, so we don't need to subscribe at the reducer
    // level any more.
    enabledProvidersCount,
  ]);

  // --- Assemble public interface ---
  return [
    {
      useApiGateway: credentialKeysHook.useApiGateway,
      customKeys: credentialKeysHook.customKeys,
      displayKeys: credentialKeysHook.displayKeys,
      initialKeys: credentialKeysHook.initialKeys,
      extraHeaders: extraHeadersHook.extraHeaders,
      customModels: customModelsHook.customModels,
      customEmbeddingsModels: customModelsHook.customEmbeddingsModels,
      useAsDefaultProvider: defaultProviderHook.useAsDefaultProvider,
      projectDefaultModel: defaultProviderHook.projectDefaultModel,
      projectTopicClusteringModel: defaultProviderHook.projectTopicClusteringModel,
      projectEmbeddingsModel: defaultProviderHook.projectEmbeddingsModel,
      name,
      routingHandle,
      scopes,
      scopeType,
      isSaving: formSubmitHook.isSaving,
      errors: formSubmitHook.errors,
      isDirty,
    },
    {
      setEnabled: formSubmitHook.setEnabled,
      setName,
      setRoutingHandle,
      setScopes,
      setScopeType,
      setUseApiGateway,
      setCustomKey: credentialKeysHook.setCustomKey,
      addExtraHeader: extraHeadersHook.addExtraHeader,
      removeExtraHeader: extraHeadersHook.removeExtraHeader,
      toggleExtraHeaderConcealed: extraHeadersHook.toggleExtraHeaderConcealed,
      setExtraHeaderKey: extraHeadersHook.setExtraHeaderKey,
      setExtraHeaderValue: extraHeadersHook.setExtraHeaderValue,
      addCustomModel: customModelsHook.addCustomModel,
      removeCustomModel: customModelsHook.removeCustomModel,
      setCustomModels: customModelsHook.setCustomModels,
      addCustomEmbeddingsModel: customModelsHook.addCustomEmbeddingsModel,
      removeCustomEmbeddingsModel: customModelsHook.removeCustomEmbeddingsModel,
      setUseAsDefaultProvider: defaultProviderHook.setUseAsDefaultProvider,
      setProjectDefaultModel: defaultProviderHook.setProjectDefaultModel,
      setProjectTopicClusteringModel: defaultProviderHook.setProjectTopicClusteringModel,
      setProjectEmbeddingsModel: defaultProviderHook.setProjectEmbeddingsModel,
      setManaged: credentialKeysHook.setManaged,
      submit: formSubmitHook.submit,
    },
  ];
}
