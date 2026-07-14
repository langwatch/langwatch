import { Badge, Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

import { Link } from "~/components/ui/link";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

import {
  buildScopeHierarchy,
  type OrgModelProvider,
  resolveEligible,
} from "./eligibleModelProviders";
import type { VirtualKeyScopeEntry } from "./VirtualKeyScopePicker";

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
  const hierarchy = useMemo(
    () => buildScopeHierarchy(availableProjects, organizationId),
    [availableProjects, organizationId],
  );

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
  const hierarchy = useMemo(
    () => buildScopeHierarchy(availableProjects, organizationId),
    [availableProjects, organizationId],
  );

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
