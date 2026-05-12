import {
  Box,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, Users } from "lucide-react";
import { useMemo } from "react";
import type {
  ModelProviderScopeType,
  ScopeSelection,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { Select } from "../ui/select";
import { SmallLabel } from "../SmallLabel";
import { ProviderScopeChips } from "./ProviderScopeChips";

type ScopeOption = {
  value: string;
  label: string;
  scopeType: ModelProviderScopeType;
  scopeId: string;
};

const SCOPE_DESCRIPTION_SINGLE: Record<ModelProviderScopeType, string> = {
  PROJECT: "Only this project can use this provider.",
  TEAM: "Every project in the team inherits this provider.",
  ORGANIZATION: "Every project in the organization inherits this provider.",
};

function summariseSelection(scopes: ScopeSelection[]): string {
  if (scopes.length === 0) {
    return "Pick at least one scope to grant access.";
  }
  if (scopes.length === 1) {
    return SCOPE_DESCRIPTION_SINGLE[scopes[0]!.scopeType];
  }
  const counts = scopes.reduce(
    (acc, s) => {
      acc[s.scopeType] = (acc[s.scopeType] ?? 0) + 1;
      return acc;
    },
    {} as Record<ModelProviderScopeType, number>,
  );
  const parts: string[] = [];
  if (counts.ORGANIZATION) parts.push("the organization");
  if (counts.TEAM)
    parts.push(counts.TEAM === 1 ? "1 team" : `${counts.TEAM} teams`);
  if (counts.PROJECT)
    parts.push(
      counts.PROJECT === 1 ? "1 project" : `${counts.PROJECT} projects`,
    );
  return `Shared across ${parts.join(" + ")}.`;
}

const ScopeIcon = ({ scopeType }: { scopeType: ModelProviderScopeType }) => {
  if (scopeType === "ORGANIZATION") return <Building2 size={16} aria-hidden />;
  if (scopeType === "TEAM") return <Users size={16} aria-hidden />;
  return <Folder size={16} aria-hidden />;
};

/**
 * Scope picker for model providers.
 *
 * For NEW providers, renders a Chakra multi-select over the organization,
 * every team the caller is a member of, and the projects inside those
 * teams. Users pick one or more scopes; every selected entry becomes a
 * ModelProviderScope row on save. The service runs fail-closed authz per
 * entry — selecting a scope the caller cannot manage rejects the whole
 * write, there is no partial-success path.
 *
 * For EXISTING providers the section is read-only: scope changes on a
 * persisted credential happen by delete+recreate so we never silently
 * re-parent a credential across orgs/teams.
 *
 * For personal-account projects (no org/team context) the section
 * renders nothing.
 */
export function ProviderScopeSection({
  state,
  actions,
  provider,
  teamId,
  teamName,
  organizationId,
  organizationName,
  projectId,
  projectName,
  availableTeams,
  availableProjects,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  teamId: string | undefined;
  teamName?: string;
  organizationId: string | undefined;
  organizationName?: string;
  projectId?: string;
  projectName?: string;
  /** Teams the caller can pick for TEAM scope. Falls back to [{id:teamId}] when omitted. */
  availableTeams?: Array<{ id: string; name: string }>;
  /** Projects the caller can pick for PROJECT scope. Falls back to [{id:projectId}]. */
  availableProjects?: Array<{ id: string; name: string; teamId?: string }>;
}) {
  const isExisting = Boolean(provider.id);
  const hasOrgOrTeam = Boolean(organizationId ?? teamId);

  // Build options from the accessible set. Falls back to the active
  // context IDs when the caller hasn't provided a full team/project
  // list — single-scope flows keep working unchanged.
  const options = useMemo<ScopeOption[]>(() => {
    const out: ScopeOption[] = [];
    if (organizationId) {
      out.push({
        value: `ORGANIZATION:${organizationId}`,
        label: organizationName ?? "Organization",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
    }
    const teams =
      availableTeams && availableTeams.length > 0
        ? availableTeams
        : teamId
          ? [{ id: teamId, name: teamName ?? "Team" }]
          : [];
    for (const team of teams) {
      out.push({
        value: `TEAM:${team.id}`,
        label: team.name,
        scopeType: "TEAM",
        scopeId: team.id,
      });
    }
    const projects =
      availableProjects && availableProjects.length > 0
        ? availableProjects
        : projectId
          ? [{ id: projectId, name: projectName ?? "Project" }]
          : [];
    for (const project of projects) {
      out.push({
        value: `PROJECT:${project.id}`,
        label: project.name,
        scopeType: "PROJECT",
        scopeId: project.id,
      });
    }
    return out;
  }, [
    organizationId,
    organizationName,
    teamId,
    teamName,
    projectId,
    projectName,
    availableTeams,
    availableProjects,
  ]);

  const collection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );

  const selectedValues = useMemo(
    () => state.scopes.map((s) => `${s.scopeType}:${s.scopeId}`),
    [state.scopes],
  );

  if (isExisting) {
    const storedScopes: ScopeSelection[] =
      provider.scopes && provider.scopes.length > 0
        ? provider.scopes.map((s) => ({
            scopeType: s.scopeType,
            scopeId: s.scopeId,
          }))
        : provider.scopeType
          ? [{ scopeType: provider.scopeType, scopeId: provider.scopeId ?? "" }]
          : [{ scopeType: "PROJECT", scopeId: projectId ?? "" }];

    if (
      !hasOrgOrTeam &&
      storedScopes.every((s) => s.scopeType === "PROJECT")
    ) {
      return null;
    }

    return (
      <VStack align="start" width="full" gap={2}>
        <SmallLabel>Scope</SmallLabel>
        <ProviderScopeChips scopes={storedScopes} />
        <Text fontSize="xs" color="gray.600">
          {summariseSelection(storedScopes)}
        </Text>
        <Text fontSize="xs" color="gray.500">
          Scope is fixed after create. To change it, delete and recreate
          at the new scope.
        </Text>
      </VStack>
    );
  }

  if (!hasOrgOrTeam) return null;

  return (
    <VStack align="start" width="full" gap={2}>
      <SmallLabel>Scope</SmallLabel>
      <Select.Root
        collection={collection}
        value={selectedValues}
        multiple
        onValueChange={(details) => {
          const picked = new Set(details.value);
          const next = options
            .filter((o) => picked.has(o.value))
            .map((o) => ({ scopeType: o.scopeType, scopeId: o.scopeId }));
          actions.setScopes(next);
        }}
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Pick one or more scopes">
            {() => {
              if (state.scopes.length === 0) return "Pick one or more scopes";
              return <ProviderScopeChips scopes={state.scopes} />;
            }}
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content>
          {options.some((o) => o.scopeType === "ORGANIZATION") && (
            <Select.ItemGroup label="Organization">
              {options
                .filter((o) => o.scopeType === "ORGANIZATION")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="ORGANIZATION" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
          {options.some((o) => o.scopeType === "TEAM") && (
            <Select.ItemGroup label="Teams">
              {options
                .filter((o) => o.scopeType === "TEAM")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="TEAM" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
          {options.some((o) => o.scopeType === "PROJECT") && (
            <Select.ItemGroup label="Projects">
              {options
                .filter((o) => o.scopeType === "PROJECT")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="PROJECT" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
        </Select.Content>
      </Select.Root>
      <Box>
        <Text fontSize="xs" color="gray.600">
          {summariseSelection(state.scopes)}
        </Text>
      </Box>
    </VStack>
  );
}
