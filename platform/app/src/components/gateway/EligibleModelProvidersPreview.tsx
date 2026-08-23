import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { modelProviderIcons } from "~/components/modelProviders/iconsMap";
import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import { Link } from "~/components/ui/link";

import {
  buildScopeHierarchy,
  type ModelProviderScopeEntry,
  type OrgModelProvider,
  resolveEligible,
  type VirtualKeyScopeEntry,
} from "./eligibleModelProviders";

type ScopeNames = {
  organizationName?: string;
  teamNames: Map<string, string>;
  projectNames: Map<string, string>;
};

function scopeName(
  scope: ModelProviderScopeEntry | VirtualKeyScopeEntry,
  names: ScopeNames,
): string | undefined {
  switch (scope.scopeType) {
    case "ORGANIZATION":
      return names.organizationName;
    case "TEAM":
      return names.teamNames.get(scope.scopeId);
    case "PROJECT":
      return names.projectNames.get(scope.scopeId);
  }
}

/**
 * "Doc Chat", "Doc Chat and Growth", "Doc Chat, Growth and Support" — the
 * scopes named the way the user picked them in the chips right above, so
 * the sentence reads back their own choice rather than a scope type.
 */
function listScopeNames(
  scopes: VirtualKeyScopeEntry[],
  names: ScopeNames,
): string {
  const labels = scopes.map((s) => scopeName(s, names) ?? s.scopeId);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]!}`;
}

export function EligibleModelProvidersPreview({
  scopes,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
  isLoading,
  providers,
  providersAllowed,
  routingPolicyProviderIds,
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
   * The key's own provider allowlist, for a read-only view of a key that
   * already exists. Omitted by the pickers, which have to offer providers
   * the key does not hold yet.
   */
  providersAllowed?: string[] | null;
  /**
   * The providers the key's routing policy names, when it is pinned to one.
   * A provider the key may hold but the policy leaves out is tagged, since
   * the policy is what dispatch actually walks.
   */
  routingPolicyProviderIds?: string[] | null;
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
    () => resolveEligible({ scopes, providers, hierarchy, providersAllowed }),
    [scopes, providers, hierarchy, providersAllowed],
  );
  const inRoutingPolicy = useMemo(
    () =>
      routingPolicyProviderIds && routingPolicyProviderIds.length > 0
        ? new Set(routingPolicyProviderIds)
        : null,
    [routingPolicyProviderIds],
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
        borderColor="orange.muted"
        borderRadius="md"
        background="orange.subtle"
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
            ? modelProviderIcons[mp.provider as keyof typeof modelProviderIcons]
            : null;
        const isSelected = selectedModel === mp.defaultModel;
        return (
          <HStack
            key={mp.id}
            borderWidth="1px"
            borderColor={isSelected ? "blue.emphasized" : "border.subtle"}
            borderRadius="md"
            paddingX={2}
            paddingY={1.5}
            gap={2}
            cursor={interactive ? "pointer" : "default"}
            background={isSelected ? "blue.subtle" : undefined}
            _hover={
              interactive
                ? { background: isSelected ? "blue.subtle" : "bg.subtle" }
                : undefined
            }
            onClick={
              interactive
                ? () => onSelectProviderModel?.(mp.defaultModel)
                : undefined
            }
            title={
              interactive
                ? `Use ${mp.defaultModel} in the snippet above`
                : undefined
            }
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
            {inRoutingPolicy && !inRoutingPolicy.has(mp.id) && (
              <Text
                fontSize="2xs"
                color="fg.muted"
                data-testid={`vk-provider-outside-policy-${mp.id}`}
              >
                Not in routing policy
              </Text>
            )}
            <Box flex={1} />
            <ProviderScopeChips
              size="xs"
              scopes={[
                {
                  scopeType: mp.definedAt.scopeType,
                  scopeId: mp.definedAt.scopeId,
                  name: scopeName(mp.definedAt, names),
                },
              ]}
            />
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
  providersAllowed,
}: {
  scopes: VirtualKeyScopeEntry[];
  organizationId: string | undefined;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  isLoading?: boolean;
  providers: OrgModelProvider[];
  /** The key's own provider allowlist; see the preview's own prop. */
  providersAllowed?: string[] | null;
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
    () => resolveEligible({ scopes, providers, hierarchy, providersAllowed }),
    [scopes, providers, hierarchy, providersAllowed],
  );

  if (scopes.length === 0 || isLoading || eligible.length === 0) return null;

  const scopeSummary = listScopeNames(scopes, names);
  const totalModels = eligible.reduce((sum, p) => sum + p.modelCount, 0);

  return (
    <Text fontSize="xs" color="fg.muted">
      This key works in {scopeSummary} and can route to{" "}
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
      color="blue.fgMuted"
      fontSize="xs"
    >
      <HStack gap={1} alignItems="center">
        <Text as="span">Configure</Text>
        <ExternalLink size={11} />
      </HStack>
    </Link>
  );
}
