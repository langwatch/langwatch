import { Badge, Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

import { Link } from "~/components/ui/link";
import { modelProviderRegistry } from "~/features/onboarding/regions/model-providers/registry";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

import type { VirtualKeyScopeEntry } from "./VirtualKeyScopePicker";

type ScopeKey = `${VirtualKeyScopeEntry["scopeType"]}:${string}`;

type OrgModelProvider = {
  id?: string | null;
  name?: string | null;
  provider: string;
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
  models?: string[] | null;
  customModels?: Array<{ model: string }> | null;
};

type EligibleModelProvider = {
  id: string;
  provider: string;
  label: string;
  modelCount: number;
  inheritedFrom: VirtualKeyScopeEntry;
  defaultModel: string;
};

// Resolve the snippet-friendly model string for a provider row. The
// gateway accepts both bare `gpt-5-mini` (OpenAI-SDK drop-in) and
// `vendor/model` form. We emit the vendor-prefixed default per the
// provider registry so a click on the row writes a model that the VK
// can actually route to that specific provider.
function resolveProviderDefaultModel(
  providerKey: string,
  providerLabel: string,
  providerModels: string[],
): string {
  const registry = modelProviderRegistry.find(
    (entry) => entry.backendModelProviderKey === providerKey,
  );
  const fallbackModel = providerModels[0];
  const defaultModel = registry?.defaultModel ?? fallbackModel;
  if (!defaultModel) {
    // Best-effort: the registry has no default and the provider also
    // shipped no models in scope. Emit the bare provider name; the
    // gateway will surface a 404 the user can read instead of a silent
    // empty model string.
    return providerLabel.toLowerCase();
  }
  return `${providerKey}/${defaultModel}`;
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
 * "inheritedFrom" chip in the picker UI) — that's the spec's
 * "via ORG"/"via TEAM:platform" annotation.
 */
function resolveEligible(
  scopes: VirtualKeyScopeEntry[],
  providers: OrgModelProvider[],
  hierarchy: {
    organizationId: string | undefined;
    teamOfProject: Map<string, string>;
  },
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
      if (vkScope.scopeType === "TEAM") return mpScope.scopeId === vkScope.scopeId;
      const teamOfVkProject = hierarchy.teamOfProject.get(vkScope.scopeId);
      return mpScope.scopeId === teamOfVkProject;
    }
    if (mpScope.scopeType === "PROJECT") {
      return vkScope.scopeType === "PROJECT" && mpScope.scopeId === vkScope.scopeId;
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
        ),
      });
    }
  }
  return Array.from(result.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

function scopeChipLabel(
  scope: VirtualKeyScopeEntry,
  names: {
    organizationName?: string;
    teamNames: Map<string, string>;
    projectNames: Map<string, string>;
  },
): string {
  switch (scope.scopeType) {
    case "ORGANIZATION":
      return `via ORG${names.organizationName ? `:${names.organizationName}` : ""}`;
    case "TEAM":
      return `via TEAM:${names.teamNames.get(scope.scopeId) ?? scope.scopeId}`;
    case "PROJECT":
      return `via PROJECT:${names.projectNames.get(scope.scopeId) ?? scope.scopeId}`;
  }
}

function summariseScopes(
  scopes: VirtualKeyScopeEntry[],
  names: {
    organizationName?: string;
    teamNames: Map<string, string>;
    projectNames: Map<string, string>;
  },
): string {
  return scopes
    .map((s) => {
      const tail =
        s.scopeType === "ORGANIZATION"
          ? names.organizationName ?? s.scopeId
          : s.scopeType === "TEAM"
          ? names.teamNames.get(s.scopeId) ?? s.scopeId
          : names.projectNames.get(s.scopeId) ?? s.scopeId;
      return `${s.scopeType}:${tail}`;
    })
    .join(" + ");
}

export function EligibleModelProvidersPreview({
  scopes,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
  isLoading,
  providers,
  selectedModel,
  onSelectProviderModel,
}: {
  scopes: VirtualKeyScopeEntry[];
  organizationId: string | undefined;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  isLoading?: boolean;
  providers: OrgModelProvider[];
  /**
   * When provided, rows render as clickable. Clicking writes the
   * provider's vendor-prefixed default model back via the callback
   * (e.g. `anthropic/claude-sonnet-4-5`) so a parent code-example
   * surface can rewrite its `model="..."` line.
   */
  selectedModel?: string;
  onSelectProviderModel?: (model: string) => void;
}) {
  const hierarchy = useMemo(() => {
    const teamOfProject = new Map<string, string>();
    for (const p of availableProjects) {
      if (p.teamId) teamOfProject.set(p.id, p.teamId);
    }
    return { organizationId, teamOfProject };
  }, [availableProjects, organizationId]);

  const names = useMemo(() => {
    const teamNames = new Map(availableTeams.map((t) => [t.id, t.name]));
    const projectNames = new Map(
      availableProjects.map((p) => {
        const clean = p.name.split(" · ")[0] ?? p.name;
        return [p.id, clean] as const;
      }),
    );
    return { organizationName, teamNames, projectNames };
  }, [availableTeams, availableProjects, organizationName]);

  const eligible = useMemo(
    () => resolveEligible(scopes, providers, hierarchy),
    [scopes, providers, hierarchy],
  );

  if (scopes.length === 0) {
    return (
      <Text fontSize="xs" color="fg.muted">
        Pick a scope above to preview the routable models.
      </Text>
    );
  }

  if (isLoading) {
    return (
      <HStack gap={2}>
        <Spinner size="xs" />
        <Text fontSize="xs" color="fg.muted">
          Resolving eligible model providers…
        </Text>
      </HStack>
    );
  }

  if (eligible.length === 0) {
    return (
      <VStack
        align="stretch"
        gap={2}
        borderWidth="1px"
        borderColor="orange.200"
        borderRadius="md"
        background="orange.50"
        padding={3}
      >
        <Text fontSize="sm" fontWeight="medium">
          No model providers visible at this scope.
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Ask an admin to add one at{" "}
          <Text as="span" fontFamily="mono">
            /settings/model-providers
          </Text>
          . The key cannot route requests until at least one provider is in
          scope.
        </Text>
      </VStack>
    );
  }

  const interactive = !!onSelectProviderModel;

  return (
    <VStack align="stretch" gap={1}>
      {eligible.map((mp) => {
        const icon =
          mp.provider in modelProviderIcons
            ? modelProviderIcons[
                mp.provider as keyof typeof modelProviderIcons
              ]
            : null;
        const isSelected = selectedModel === mp.defaultModel;
        return (
          <HStack
            key={mp.id}
            borderWidth="1px"
            borderColor={isSelected ? "blue.400" : "border.subtle"}
            borderRadius="md"
            paddingX={2}
            paddingY={1.5}
            gap={2}
            cursor={interactive ? "pointer" : "default"}
            background={isSelected ? "blue.50" : undefined}
            _hover={
              interactive
                ? { background: isSelected ? "blue.50" : "bg.subtle" }
                : undefined
            }
            onClick={
              interactive
                ? () => onSelectProviderModel?.(mp.defaultModel)
                : undefined
            }
            title={interactive ? `Use ${mp.defaultModel} in the snippet above` : undefined}
          >
            <Box
              width="16px"
              height="16px"
              flexShrink={0}
              display="flex"
              alignItems="center"
              justifyContent="center"
              css={{ "& > svg": { width: "100%", height: "100%" } }}
            >
              {icon}
            </Box>
            <Text fontSize="sm" fontWeight="medium">
              {mp.label}
            </Text>
            {mp.modelCount > 0 && (
              <Text fontSize="xs" color="fg.muted">
                · {mp.modelCount} {mp.modelCount === 1 ? "model" : "models"}
              </Text>
            )}
            {interactive && (
              <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                {mp.defaultModel}
              </Text>
            )}
            <Box flex={1} />
            <Badge variant="subtle" colorPalette="gray" fontSize="2xs">
              {scopeChipLabel(mp.inheritedFrom, names)}
            </Badge>
          </HStack>
        );
      })}
    </VStack>
  );
}

/**
 * Single-sentence summary of the VK's reach + eligible-MP count. Rendered
 * by the drawer directly under the scope picker so the user reads the
 * implication of their scope choice before scanning the provider list.
 *
 * Kept as a separate component (rather than folded into the preview list)
 * so the summary copy sits next to the scope picker and the list sits
 * next to its own "Eligible model providers" section header.
 */
export function EligibleModelProvidersSummary({
  scopes,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
  isLoading,
  providers,
}: {
  scopes: VirtualKeyScopeEntry[];
  organizationId: string | undefined;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  isLoading?: boolean;
  providers: OrgModelProvider[];
}) {
  const hierarchy = useMemo(() => {
    const teamOfProject = new Map<string, string>();
    for (const p of availableProjects) {
      if (p.teamId) teamOfProject.set(p.id, p.teamId);
    }
    return { organizationId, teamOfProject };
  }, [availableProjects, organizationId]);

  const names = useMemo(() => {
    const teamNames = new Map(availableTeams.map((t) => [t.id, t.name]));
    const projectNames = new Map(
      availableProjects.map((p) => {
        const clean = p.name.split(" · ")[0] ?? p.name;
        return [p.id, clean] as const;
      }),
    );
    return { organizationName, teamNames, projectNames };
  }, [availableTeams, availableProjects, organizationName]);

  const eligible = useMemo(
    () => resolveEligible(scopes, providers, hierarchy),
    [scopes, providers, hierarchy],
  );

  if (scopes.length === 0 || isLoading || eligible.length === 0) return null;

  const scopeSummary = summariseScopes(scopes, names);
  const totalModels = eligible.reduce((sum, p) => sum + p.modelCount, 0);

  return (
    <Text fontSize="xs" color="fg.muted">
      This VK will be usable within {scopeSummary} and can fall back to{" "}
      {eligible.length === 1 ? "1 provider" : `${eligible.length} providers`}
      {totalModels > 0
        ? ` (${totalModels} ${totalModels === 1 ? "model" : "models"})`
        : ""}
      .
    </Text>
  );
}

/**
 * "Configure ↗" deep-link to /settings/model-providers, pre-seeded with
 * a `?scope=TYPE:ID` query param for each currently-selected VK scope.
 * Lands the admin on the provider list filtered to the same scope set the
 * VK already targets, so adding a missing provider is one click away.
 *
 * The receiving page hydrates its local scopeFilter from router.query;
 * if it doesn't, the user still arrives at the right page (option-a per
 * the bug-10 split — full hydrate lands as a follow-up).
 */
export function ConfigureModelProvidersLink({
  scopes,
}: {
  scopes: VirtualKeyScopeEntry[];
}) {
  const href = useMemo(() => {
    if (scopes.length === 0) return "/settings/model-providers";
    const params = new URLSearchParams();
    for (const s of scopes) {
      params.append("scope", `${s.scopeType}:${s.scopeId}`);
    }
    return `/settings/model-providers?${params.toString()}`;
  }, [scopes]);

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      color="blue.600"
      fontSize="xs"
    >
      <HStack gap={1} alignItems="center">
        <Text as="span">Configure</Text>
        <ExternalLink size={11} />
      </HStack>
    </Link>
  );
}

export type { OrgModelProvider, EligibleModelProvider };
