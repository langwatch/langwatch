import { useCallback, useEffect, useState } from "react";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { useCredentialKeys } from "./useCredentialKeys";
import { useCustomModels } from "./useCustomModels";
import { useDefaultProviderSelection } from "./useDefaultProviderSelection";
import { type ExtraHeader, useExtraHeaders } from "./useExtraHeaders";
import { type FormSnapshot, useProviderFormSubmit } from "./useProviderFormSubmit";

export type ModelProviderScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export type ScopeSelection = {
  scopeType: ModelProviderScopeType;
  scopeId: string;
};

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
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

export type UseModelProviderFormState = {
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
};

export type UseModelProviderFormActions = {
  setEnabled: (enabled: boolean) => Promise<void>;
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
    project,
    enabledProvidersCount,
    isUsingEnvVars,
    teamId,
    organizationId,
    canManageOrganization,
    canManageTeam,
    onSuccess,
    onError,
  } = params;

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
    project,
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
      scopes,
      scopeType,
      scopeId,
    ],
  );

  const formSubmitHook = useProviderFormSubmit({
    getFormSnapshot,
    onSuccess,
    onError,
  });

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
    defaultProviderHook.reset(provider, project, enabledProvidersCount);
    formSubmitHook.reset();
  }, [
    provider.provider,
    provider.id,
    provider.enabled,
    provider.customKeys,
    provider.customModels,
    provider.customEmbeddingsModels,
    provider.extraHeaders,
    project?.defaultModel,
    project?.topicClusteringModel,
    project?.embeddingsModel,
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
      scopes,
      scopeType,
      isSaving: formSubmitHook.isSaving,
      errors: formSubmitHook.errors,
    },
    {
      setEnabled: formSubmitHook.setEnabled,
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
