import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import {
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../server/modelProviders/registry";
import {
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
} from "../utils/modelProviderHelpers";

// Mirrors the server's deriveDefaultName. Kept here so the drawer can
// pre-fill the input on open without an extra tRPC round trip.
function humanizeProviderName(providerKey: string): string {
  const def =
    modelProvidersRegistry[providerKey as keyof typeof modelProvidersRegistry];
  if (def?.name) return def.name;
  return providerKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
import {
  computeInitialUseApiGateway,
  useCredentialKeys,
} from "./useCredentialKeys";
import { useCustomModels } from "./useCustomModels";
import { useDefaultProviderSelection } from "./useDefaultProviderSelection";
import { type ExtraHeader, useExtraHeaders } from "./useExtraHeaders";
import {
  type AdvancedGatewayPayload,
  type FormSnapshot,
  useProviderFormSubmit,
} from "./useProviderFormSubmit";

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
    (provider as { name?: string }).name ??
    humanizeProviderName(provider.provider);
  const [name, setName] = useState<string>(initialName);

  // Scope state — defaults to the stored provider's scope set when
  // editing. For brand-new providers we open at the widest scope the
  // user can manage (org > team > project) so an admin lands on the
  // most useful default instead of having to flip from PROJECT every
  // time. Iter 109 made this an array; existing callers that only
  // expect a single tier still work via the derived `scopeType`.
  const defaultNewScope: ModelProviderScopeType =
    canManageOrganization && organizationId
      ? "ORGANIZATION"
      : canManageTeam && teamId
        ? "TEAM"
        : "PROJECT";
  const defaultScopeId =
    defaultNewScope === "ORGANIZATION"
      ? organizationId
      : defaultNewScope === "TEAM"
        ? teamId
        : projectId;

  const initialScopes: ScopeSelection[] =
    provider.scopes && provider.scopes.length > 0
      ? provider.scopes.map((s) => ({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        }))
      : provider.scopeType && provider.scopeId
        ? [{ scopeType: provider.scopeType, scopeId: provider.scopeId }]
        : defaultScopeId
          ? [{ scopeType: defaultNewScope, scopeId: defaultScopeId }]
          : [];
  const [scopes, setScopes] = useState<ScopeSelection[]>(initialScopes);

  // Narrowest tier (PROJECT > TEAM > ORGANIZATION) — legacy consumers
  // that expected a single `scopeType` pick the most specific one.
  const scopeType: ModelProviderScopeType = scopes.some(
    (s) => s.scopeType === "PROJECT",
  )
    ? "PROJECT"
    : scopes.some((s) => s.scopeType === "TEAM")
      ? "TEAM"
      : scopes[0]?.scopeType ?? defaultNewScope;

  const scopeId =
    scopes.find((s) => s.scopeType === scopeType)?.scopeId ?? undefined;

  const setScopeType = useCallback(
    (next: ModelProviderScopeType) => {
      const nextId =
        next === "ORGANIZATION"
          ? organizationId
          : next === "TEAM"
            ? teamId
            : projectId;
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
      isUsingEnvVars,
      customKeys: credentialKeysHook.customKeys,
      initialKeys: credentialKeysHook.originalStoredKeysRef.current,
      providerKeysSchema: credentialKeysHook.providerDefinition?.keysSchema,
      extraHeaders: extraHeadersHook.extraHeaders,
      customModels: customModelsHook.customModels,
      customEmbeddingsModels: customModelsHook.customEmbeddingsModels,
      useAsDefaultProvider: defaultProviderHook.useAsDefaultProvider,
      projectDefaultModel: defaultProviderHook.projectDefaultModel,
      projectTopicClusteringModel:
        defaultProviderHook.projectTopicClusteringModel,
      projectEmbeddingsModel: defaultProviderHook.projectEmbeddingsModel,
      name,
      scopes,
      scopeType,
      scopeId,
    }),
    [
      provider,
      projectId,
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

  // Dirty detection drives the Save button. Compared per-field so the
  // helpers that already know about MASKED_KEY_PLACEHOLDER (api keys) are
  // reused — a naive JSON.stringify of customKeys would always look dirty
  // because the form shows the masked sentinel while the stored value is
  // the real key.
  const isDirty = useMemo(() => {
    const initialName =
      (provider as { name?: string }).name ??
      humanizeProviderName(provider.provider);
    if (name.trim() !== initialName.trim()) return true;

    if (hasUserEnteredNewApiKey(credentialKeysHook.customKeys)) return true;
    if (
      hasUserModifiedNonApiKeyFields(
        credentialKeysHook.customKeys,
        credentialKeysHook.originalStoredKeysRef.current as Record<
          string,
          unknown
        >,
      )
    ) {
      return true;
    }

    if (
      credentialKeysHook.useApiGateway !== computeInitialUseApiGateway(provider)
    ) {
      return true;
    }

    // Scope set: order-insensitive — two scopes added in different order
    // shouldn't read as dirty.
    const storedScopes: { scopeType: string; scopeId: string }[] =
      provider.scopes && provider.scopes.length > 0
        ? provider.scopes
        : provider.scopeType && provider.scopeId
          ? [{ scopeType: provider.scopeType, scopeId: provider.scopeId }]
          : [];
    const scopeSig = (xs: { scopeType: string; scopeId: string }[]) =>
      xs
        .map((s) => `${s.scopeType}|${s.scopeId}`)
        .sort()
        .join(",");
    if (scopeSig(scopes) !== scopeSig(storedScopes)) return true;

    // Headers and models: order-sensitive JSON compare. Reordering a list
    // counts as dirty here, which matches user intent (the user dragged
    // them on purpose).
    if (
      JSON.stringify(extraHeadersHook.extraHeaders) !==
      JSON.stringify(provider.extraHeaders ?? [])
    ) {
      return true;
    }
    const providerWithModels = provider as {
      customModels?: unknown;
      customEmbeddingsModels?: unknown;
    };
    if (
      JSON.stringify(customModelsHook.customModels) !==
      JSON.stringify(providerWithModels.customModels ?? [])
    ) {
      return true;
    }
    if (
      JSON.stringify(customModelsHook.customEmbeddingsModels) !==
      JSON.stringify(providerWithModels.customEmbeddingsModels ?? [])
    ) {
      return true;
    }

    return false;
  }, [
    provider,
    name,
    credentialKeysHook.customKeys,
    credentialKeysHook.originalStoredKeysRef,
    credentialKeysHook.useApiGateway,
    scopes,
    extraHeadersHook.extraHeaders,
    customModelsHook.customModels,
    customModelsHook.customEmbeddingsModels,
  ]);

  // --- Cross-hook coordination: gateway toggle wires credential keys → extra headers ---
  const handleGatewayToggle = useCallback(
    (useGateway: boolean) => {
      if (provider.provider === "azure" && useGateway) {
        extraHeadersHook.ensureApiKeyHeader();
      }
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
    setName(
      (provider as { name?: string }).name ??
        humanizeProviderName(provider.provider),
    );
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
      projectTopicClusteringModel:
        defaultProviderHook.projectTopicClusteringModel,
      projectEmbeddingsModel: defaultProviderHook.projectEmbeddingsModel,
      name,
      scopes,
      scopeType,
      isSaving: formSubmitHook.isSaving,
      errors: formSubmitHook.errors,
      isDirty,
    },
    {
      setEnabled: formSubmitHook.setEnabled,
      setName,
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
      setProjectTopicClusteringModel:
        defaultProviderHook.setProjectTopicClusteringModel,
      setProjectEmbeddingsModel: defaultProviderHook.setProjectEmbeddingsModel,
      setManaged: credentialKeysHook.setManaged,
      submit: formSubmitHook.submit,
    },
  ];
}
