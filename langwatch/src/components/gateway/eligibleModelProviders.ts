import { modelProviderRegistry } from "~/features/onboarding/regions/model-providers/registry";

import type { VirtualKeyScopeEntry } from "./VirtualKeyScopePicker";

export type OrgModelProvider = {
  id?: string | null;
  name?: string | null;
  provider: string;
  scopes: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  models?: string[] | null;
  customModels?: Array<{ modelId: string }> | null;
};

export type EligibleModelProvider = {
  id: string;
  provider: string;
  label: string;
  modelCount: number;
  inheritedFrom: VirtualKeyScopeEntry;
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
 * Resolves the union eligible-ModelProvider set for a multi-scope VirtualKey
 * client-side, mirroring `scopeResolver.eligibleModelProvidersForVk` on the
 * server. Inheritance rule from specs/ai-gateway/governance/vk-scope-inheritance.feature:
 *
 *   "A VK at scope S sees a ModelProvider P iff P's scope is an ancestor
 *    of S OR equal to S. ORG is the broadest, then TEAM, then PROJECT."
 *
 * Each surviving MP carries the broadest VK scope that admitted it (the
 * "inheritedFrom" chip in the picker UI).
 */
export function resolveEligible(
  scopes: VirtualKeyScopeEntry[],
  providers: OrgModelProvider[],
  hierarchy: ScopeHierarchy,
): EligibleModelProvider[] {
  if (scopes.length === 0 || providers.length === 0) return [];
  const matchesScope = (
    mpScope: { scopeType: string; scopeId: string },
    vkScope: VirtualKeyScopeEntry,
  ): boolean => {
    if (mpScope.scopeType === "ORGANIZATION") {
      return mpScope.scopeId === hierarchy.organizationId;
    }
    if (mpScope.scopeType === "TEAM") {
      if (vkScope.scopeType === "ORGANIZATION") return false;
      if (vkScope.scopeType === "TEAM")
        return mpScope.scopeId === vkScope.scopeId;
      const teamOfVkProject = hierarchy.teamOfProject.get(vkScope.scopeId);
      return mpScope.scopeId === teamOfVkProject;
    }
    if (mpScope.scopeType === "PROJECT") {
      return (
        vkScope.scopeType === "PROJECT" && mpScope.scopeId === vkScope.scopeId
      );
    }
    return false;
  };

  const result = new Map<string, EligibleModelProvider>();
  for (const provider of providers) {
    if (!provider.id) continue;
    for (const mpScope of provider.scopes) {
      const winner = scopes.find((vkScope) => matchesScope(mpScope, vkScope));
      if (!winner) continue;
      if (result.has(provider.id)) continue;
      const chatModels = provider.models ?? [];
      const customCount = provider.customModels?.length ?? 0;
      const label = provider.name ?? provider.provider;
      result.set(provider.id, {
        id: provider.id,
        provider: provider.provider,
        label,
        modelCount: chatModels.length + customCount,
        inheritedFrom: winner,
        defaultModel: resolveProviderDefaultModel(
          provider.provider,
          label,
          chatModels,
          provider.customModels,
        ),
      });
    }
  }
  return Array.from(result.values()).sort((a, b) =>
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
  return resolveEligible(scopes, providers, hierarchy)[0]?.defaultModel;
}
