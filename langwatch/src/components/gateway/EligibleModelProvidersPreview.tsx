import { Badge, Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";

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
};

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
      result.set(provider.id, {
        id: provider.id,
        provider: provider.provider,
        label: provider.name ?? provider.provider,
        modelCount: chatModels.length + customCount,
        inheritedFrom: winner,
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

  if (scopes.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="md"
        padding={3}
      >
        <Text fontSize="xs" color="fg.muted">
          Pick a scope above to preview the routable models.
        </Text>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <HStack
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="md"
        padding={3}
        gap={2}
      >
        <Spinner size="xs" />
        <Text fontSize="xs" color="fg.muted">
          Resolving eligible model providers…
        </Text>
      </HStack>
    );
  }

  const scopeSummary = summariseScopes(scopes, names);

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

  const totalModels = eligible.reduce((sum, p) => sum + p.modelCount, 0);

  return (
    <VStack
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      padding={3}
    >
      <Text fontSize="xs" color="fg.muted">
        This VK will be usable within {scopeSummary} and can fall back to{" "}
        {eligible.length === 1 ? "1 provider" : `${eligible.length} providers`}
        {totalModels > 0
          ? ` (${totalModels} ${totalModels === 1 ? "model" : "models"})`
          : ""}
        .
      </Text>
      <VStack align="stretch" gap={1}>
        {eligible.map((mp) => {
          const icon =
            mp.provider in modelProviderIcons
              ? modelProviderIcons[
                  mp.provider as keyof typeof modelProviderIcons
                ]
              : null;
          return (
            <HStack
              key={mp.id}
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="md"
              paddingX={2}
              paddingY={1.5}
              gap={2}
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
              <Box flex={1} />
              <Badge variant="subtle" colorPalette="gray" fontSize="2xs">
                {scopeChipLabel(mp.inheritedFrom, names)}
              </Badge>
            </HStack>
          );
        })}
      </VStack>
    </VStack>
  );
}

export type { OrgModelProvider, EligibleModelProvider };
