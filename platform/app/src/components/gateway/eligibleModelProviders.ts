import { modelProviderRegistry } from "~/features/onboarding/regions/model-providers/registry";
import { isDispatchableProvider } from "@langwatch/model-provider-contract";
import { SCOPE_BREADTH, scopeBreadthRank } from "~/utils/scopeBreadth";

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
  disabledAt?: Date | string | null;
  scopes: ModelProviderScopeEntry[];
  models?: string[] | null;
  customModels?: Array<{ modelId: string }> | null;
};

export type EligibleModelProvider = {
  id: string;
  provider: string;
  label: string;
  modelCount: number;
  /**
   * The scope the provider itself is attached to — the broadest one that
   * reaches the key. This is where the provider was configured, never the
   * key's own scope: an organization-wide credential inherited by a
   * project key still comes from the organization.
   */
  definedAt: ModelProviderScopeEntry;
  defaultModel: string;
};

export type ScopeHierarchy = {
  organizationId: string | undefined;
  teamOfProject: Map<string, string>;
};

/**
 * Resolve the snippet-friendly model string for a provider row. The gateway
 * accepts both bare `gpt-5-mini` (OpenAI-SDK drop-in) and `vendor/model` form,
 * and its resolver strips the `vendor/` prefix before dispatch (it only
 * selects the provider, then forwards the bare model upstream), so the
 * prefixed form is always safe. We emit the vendor-prefixed default so a key
 * bound to a self-hosted vLLM/LiteLLM provider names a model that endpoint
 * actually serves instead of the OpenAI-only `gpt-5-mini`.
 *
 * Precedence: registry default (openai/anthropic/... have one) -> the
 * provider's first registry chat model -> the provider's first custom model
 * (this is where self-hosted "custom" providers keep their model ids, since
 * the custom registry entry has no default). Bare provider label only as a
 * last resort so the gateway surfaces a readable 404 instead of an empty
 * model field.
 */
export function resolveProviderDefaultModel(
  providerKey: string,
  providerLabel: string,
  providerModels: string[],
  customModels?: Array<{ modelId: string }> | null,
): string {
  const registry = modelProviderRegistry.find(
    (entry) => entry.backendModelProviderKey === providerKey,
  );
  const fallbackModel = providerModels[0] ?? customModels?.[0]?.modelId;
  const defaultModel = registry?.defaultModel ?? fallbackModel;
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
  availableProjects: Array<{ id: string; teamId?: string }>,
  organizationId: string | undefined,
): ScopeHierarchy {
  const teamOfProject = new Map<string, string>();
  for (const p of availableProjects) {
    if (p.teamId) teamOfProject.set(p.id, p.teamId);
  }
  return { organizationId, teamOfProject };
}

/**
 * A provider is only offered to a key when the gateway would actually
 * dispatch to it: `enabled: true, disabledAt: null` AND registry-dispatchable
 * (shared `isDispatchableProvider` — the predicate
 * `scopeResolver.eligibleModelProvidersForVk` also applies), so the picker
 * never advertises a provider the dispatch chain would drop.
 * The enabled/disabledAt dimension fails closed — a row that arrives without
 * the flag is not advertised, because listing a credential an admin has
 * withdrawn overstates the key's reach and is a governance problem, not a
 * cosmetic one. The registry dimension's failure direction is stated on
 * `isDispatchableProvider` itself.
 */
function isRoutable(provider: OrgModelProvider): boolean {
  return (
    provider.enabled === true &&
    !provider.disabledAt &&
    isDispatchableProvider(provider.provider)
  );
}

/**
 * Resolves the union scope-reachable ModelProvider set for a multi-scope
 * VirtualKey client-side, mirroring `scopeResolver.scopeReachableModelProvidersForVk`
 * on the server. Inheritance rule from specs/ai-gateway/governance/vk-scope-inheritance.feature:
 *
 *   "A VK at scope S sees a ModelProvider P iff P's scope is an ancestor
 *    of S OR equal to S. ORG is the broadest, then TEAM, then PROJECT."
 *
 * Each surviving MP carries the broadest of its OWN scopes that the key
 * reaches, which is what the scope chip in the picker UI names. Keyed by
 * row id, so a provider attached at several scopes resolves once.
 *
 * Scope only: a key's routing policy narrows what the gateway DISPATCHES to,
 * never what its provider allowlist may name. A provider the scope reaches
 * but the policy omits stays offered here and is savable; the policy blocks
 * it at dispatch, not at save.
 *
 * Rows come back broadest scope first (ORGANIZATION, then TEAM, then
 * PROJECT), and by name within a scope.
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
   * The key's own provider allowlist, when it has one.
   *
   * Null or empty means the key may use every provider its scopes reach,
   * current and future, so the unfiltered set is the answer. A list narrows
   * it: those ids are ModelProvider row ids, the same key this function
   * resolves by. Pickers pass nothing, because they have to offer providers
   * the key does not hold yet; a read-only view of an existing key passes
   * its list, or it overstates what the key can do.
   */
  providersAllowed?: string[] | null;
}): EligibleModelProvider[] {
  if (scopes.length === 0 || providers.length === 0) return [];
  const allowed =
    providersAllowed && providersAllowed.length > 0 ? new Set(providersAllowed) : null;
  const matchesScope = (
    mpScope: ModelProviderScopeEntry,
    vkScope: VirtualKeyScopeEntry,
  ): boolean => {
    if (mpScope.scopeType === "ORGANIZATION") {
      return mpScope.scopeId === hierarchy.organizationId;
    }
    if (mpScope.scopeType === "TEAM") {
      if (vkScope.scopeType === "ORGANIZATION") return false;
      if (vkScope.scopeType === "TEAM") return mpScope.scopeId === vkScope.scopeId;
      const teamOfVkProject = hierarchy.teamOfProject.get(vkScope.scopeId);
      return mpScope.scopeId === teamOfVkProject;
    }
    if (mpScope.scopeType === "PROJECT") {
      return vkScope.scopeType === "PROJECT" && mpScope.scopeId === vkScope.scopeId;
    }
    return false;
  };

  // Rank the tiers so a provider attached at several scopes is attributed to
  // the broadest one (ORG > TEAM > PROJECT) it reaches the key through.
  const result = new Map<string, EligibleModelProvider>();
  for (const provider of providers) {
    if (!provider.id) continue;
    if (allowed && !allowed.has(provider.id)) continue;
    if (!isRoutable(provider)) continue;
    let definedAt: ModelProviderScopeEntry | undefined;
    for (const mpScope of provider.scopes) {
      if (!scopes.some((vkScope) => matchesScope(mpScope, vkScope))) continue;
      if (
        !definedAt ||
        SCOPE_BREADTH[mpScope.scopeType] < SCOPE_BREADTH[definedAt.scopeType]
      ) {
        definedAt = mpScope;
      }
    }
    if (!definedAt) continue;
    const chatModels = provider.models ?? [];
    const customCount = provider.customModels?.length ?? 0;
    const label = provider.name ?? provider.provider;
    result.set(provider.id, {
      id: provider.id,
      provider: provider.provider,
      label,
      modelCount: chatModels.length + customCount,
      definedAt,
      defaultModel: resolveProviderDefaultModel(
        provider.provider,
        label,
        chatModels,
        provider.customModels,
      ),
    });
  }
  return Array.from(result.values()).sort(
    (a, b) =>
      scopeBreadthRank(a.definedAt.scopeType) - scopeBreadthRank(b.definedAt.scopeType) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * The snippet-ready default model for a VK, in resolver-safe `vendor/model`
 * form: the first eligible provider's default. Undefined when no provider is
 * eligible/resolvable yet (callers fall back to a placeholder). This is what
 * makes the copy-paste usage example name a model the key can actually serve.
 */
export function firstEligibleDefaultModel(args: {
  scopes: VirtualKeyScopeEntry[];
  providers: OrgModelProvider[];
  availableProjects: Array<{ id: string; teamId?: string }>;
  organizationId: string | undefined;
}): string | undefined {
  const { scopes, providers, availableProjects, organizationId } = args;
  const hierarchy = buildScopeHierarchy(availableProjects, organizationId);
  return resolveEligible({ scopes, providers, hierarchy })[0]?.defaultModel;
}
