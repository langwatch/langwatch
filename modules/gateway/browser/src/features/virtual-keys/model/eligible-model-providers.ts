import { isDispatchableProvider } from "@langwatch/model-provider-contract";
import type { Instant } from "@langwatch/time";

import { MODEL_PROVIDER_DEFAULT_MODELS } from "./model-provider-default-models.ts";
import { SCOPE_BREADTH, scopeBreadthRank } from "./scope-breadth.ts";

/**
 * A scope a VirtualKey is reachable from: the org/team/project triad the
 * key's ownership persists as. Owned here (rather than by a picker
 * component) because everything provider-eligibility touches keys on it.
 */
export type VirtualKeyScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/**
 * A scope a ModelProvider is attached to. Same triad as the VK's own
 * scopes, but a different axis: this says where the *provider* lives,
 * not where the key may be used.
 */
export type ModelProviderScopeEntry = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

export type OrgModelProvider = {
  id?: string | null;
  name?: string | null;
  provider: string;
  /** Whether an admin has this credential switched on. */
  enabled?: boolean;
  /** Set once the credential has been withdrawn. */
  disabledAt?: Instant | string | null;
  scopes: ModelProviderScopeEntry[];
  models?: string[] | null;
  customModels?: { modelId: string }[] | null;
};

export type EligibleModelProvider = {
  id: string;
  provider: string;
  label: string;
  modelCount: number;
  /**
   * The scope the provider itself is attached to — the broadest one that
   * reaches the key, never the key's own scope: an org-wide credential
   * inherited by a project key still comes from the organization.
   */
  definedAt: ModelProviderScopeEntry;
  defaultModel: string;
};

export type ScopeHierarchy = {
  organizationId: string | undefined;
  teamOfProject: Map<string, string>;
};

/**
 * Resolve the snippet-friendly model string for a provider row, emitting
 * vendor-prefixed defaults for self-hosted endpoints that don't serve OpenAI models.
 */
export function resolveProviderDefaultModel({
  providerKey,
  providerLabel,
  providerModels,
  customModels,
}: {
  providerKey: string;
  providerLabel: string;
  providerModels: string[];
  customModels?: { modelId: string }[] | null;
}): string {
  const registryDefault = MODEL_PROVIDER_DEFAULT_MODELS[providerKey];
  const fallbackModel = providerModels[0] ?? customModels?.[0]?.modelId;
  const defaultModel = registryDefault ?? fallbackModel;
  if (!defaultModel) {
    return providerLabel.toLowerCase();
  }
  return `${providerKey}/${defaultModel}`;
}

/**
 * Build the team-of-project lookup the eligibility walk needs to map a VK's
 * PROJECT scope up to its owning TEAM.
 */
export function buildScopeHierarchy(
  availableProjects: { id: string; teamId?: string }[],
  organizationId: string | undefined,
): ScopeHierarchy {
  const teamOfProject = new Map<string, string>();
  for (const p of availableProjects) {
    if (p.teamId) teamOfProject.set(p.id, p.teamId);
  }
  return { organizationId, teamOfProject };
}

/**
 * A provider is only offered when the gateway would dispatch to it: both
 * enabled and registry-dispatchable.
 */
function isRoutable(provider: OrgModelProvider): boolean {
  return (
    provider.enabled === true && !provider.disabledAt && isDispatchableProvider(provider.provider)
  );
}

function providerScopeReaches({
  mpScope,
  vkScope,
  hierarchy,
}: {
  mpScope: ModelProviderScopeEntry;
  vkScope: VirtualKeyScopeEntry;
  hierarchy: ScopeHierarchy;
}): boolean {
  if (mpScope.scopeType === "ORGANIZATION") {
    return mpScope.scopeId === hierarchy.organizationId;
  }
  if (mpScope.scopeType === "TEAM") {
    if (vkScope.scopeType === "ORGANIZATION") return false;
    if (vkScope.scopeType === "TEAM") return mpScope.scopeId === vkScope.scopeId;
    return mpScope.scopeId === hierarchy.teamOfProject.get(vkScope.scopeId);
  }
  if (mpScope.scopeType === "PROJECT") {
    return vkScope.scopeType === "PROJECT" && mpScope.scopeId === vkScope.scopeId;
  }
  return false;
}

/** The broadest scope (ORG > TEAM > PROJECT) through which the provider reaches the key. */
function broadestReachingScope({
  provider,
  scopes,
  hierarchy,
}: {
  provider: OrgModelProvider;
  scopes: VirtualKeyScopeEntry[];
  hierarchy: ScopeHierarchy;
}): ModelProviderScopeEntry | undefined {
  let definedAt: ModelProviderScopeEntry | undefined;
  for (const mpScope of provider.scopes) {
    if (!scopes.some((vkScope) => providerScopeReaches({ mpScope, vkScope, hierarchy }))) continue;
    if (!definedAt || SCOPE_BREADTH[mpScope.scopeType] < SCOPE_BREADTH[definedAt.scopeType]) {
      definedAt = mpScope;
    }
  }
  return definedAt;
}

function toEligibleProvider({
  id,
  provider,
  definedAt,
}: {
  id: string;
  provider: OrgModelProvider;
  definedAt: ModelProviderScopeEntry;
}): EligibleModelProvider {
  const chatModels = provider.models ?? [];
  const customCount = provider.customModels?.length ?? 0;
  const label = provider.name ?? provider.provider;
  return {
    id,
    provider: provider.provider,
    label,
    modelCount: chatModels.length + customCount,
    definedAt,
    defaultModel: resolveProviderDefaultModel({
      providerKey: provider.provider,
      providerLabel: label,
      providerModels: chatModels,
      customModels: provider.customModels,
    }),
  };
}

/**
 * Resolves the scope-reachable ModelProvider set for a VirtualKey client-side,
 * with each provider carrying its broadest reachable scope. Rows sorted by scope
 * then name. See specs/ai-gateway/governance/vk-scope-inheritance.feature.
 */
export function resolveEligible({
  scopes,
  providers,
  hierarchy,
  providersAllowed,
}: {
  scopes: VirtualKeyScopeEntry[];
  providers: OrgModelProvider[];
  hierarchy: ScopeHierarchy;
  /**
   * The key's own provider allowlist. Null or empty means the key may use
   * every provider its scopes reach; a list narrows it to those row ids.
   */
  providersAllowed?: string[] | null;
}): EligibleModelProvider[] {
  if (scopes.length === 0 || providers.length === 0) return [];
  const allowed =
    providersAllowed && providersAllowed.length > 0 ? new Set(providersAllowed) : null;
  const result = new Map<string, EligibleModelProvider>();
  for (const provider of providers) {
    const id = provider.id;
    if (!id || (allowed && !allowed.has(id)) || !isRoutable(provider)) continue;
    const definedAt = broadestReachingScope({ provider, scopes, hierarchy });
    if (!definedAt) continue;
    result.set(id, toEligibleProvider({ id, provider, definedAt }));
  }
  return Array.from(result.values()).toSorted(
    (a, b) =>
      scopeBreadthRank(a.definedAt.scopeType) - scopeBreadthRank(b.definedAt.scopeType) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * The snippet-ready default model for a VK, `vendor/model` form: the first
 * eligible provider's default, undefined when none is eligible yet (callers
 * fall back to a placeholder) — names a model the key can actually serve.
 */
export function firstEligibleDefaultModel(args: {
  scopes: VirtualKeyScopeEntry[];
  providers: OrgModelProvider[];
  availableProjects: { id: string; teamId?: string }[];
  organizationId: string | undefined;
}): string | undefined {
  const { scopes, providers, availableProjects, organizationId } = args;
  const hierarchy = buildScopeHierarchy(availableProjects, organizationId);
  return resolveEligible({ scopes, providers, hierarchy })[0]?.defaultModel;
}
