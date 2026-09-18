import { Text, VStack } from "@chakra-ui/react";
import { ProviderScopeChips, ScopeChipPicker } from "@langwatch/authz-browser-kit";
import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "@langwatch/model-provider-contract";

import type {
  ModelProviderScopeType,
  ScopeSelection,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import { SmallLabel } from "../elements/small-label.tsx";

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
  if (counts.TEAM) parts.push(counts.TEAM === 1 ? "1 team" : `${counts.TEAM} teams`);
  if (counts.PROJECT) parts.push(counts.PROJECT === 1 ? "1 project" : `${counts.PROJECT} projects`);
  return `Shared across ${parts.join(" + ")}.`;
}

/**
 * New providers get quick-add chips (single scope, the common case) plus the full picker below for
 * cross-team setups. Existing providers are read-only here — scope changes go through delete +
 * recreate so a credential never silently re-parents across orgs/teams.
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
  availableTeams?: { id: string; name: string }[];
  availableProjects?: { id: string; name: string; teamId?: string }[];
}) {
  const isExisting = Boolean(provider.id);
  const hasOrgOrTeam = Boolean(organizationId ?? teamId);

  if (isExisting) {
    const fallbackScopes: ScopeSelection[] = provider.scopeType
      ? [{ scopeType: provider.scopeType, scopeId: provider.scopeId ?? "" }]
      : [{ scopeType: "PROJECT", scopeId: projectId ?? "" }];
    const storedScopes: ScopeSelection[] =
      provider.scopes && provider.scopes.length > 0
        ? provider.scopes.map((s) => ({
            scopeType: s.scopeType,
            scopeId: s.scopeId,
          }))
        : fallbackScopes;

    if (!hasOrgOrTeam && storedScopes.every((s) => s.scopeType === "PROJECT")) {
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
          Scope is fixed after create. To change it, delete and recreate at the new scope.
        </Text>
      </VStack>
    );
  }

  if (!hasOrgOrTeam) return null;

  // Dropdown-only: the quick-pick chips (Organization / This team / This
  // project / Multiple) were redundant and dropped from both drawers. The
  // dropdown already surfaces every reachable scope; the chip variant stays
  // on `ScopeChipPicker` (`showQuickPicks`) for future chip-row UX.
  return (
    <VStack align="start" width="full" gap={1.5}>
      <SmallLabel>Scope</SmallLabel>
      <ScopeChipPicker
        value={state.scopes}
        onChange={(next) => actions.setScopes(next)}
        organizationId={organizationId}
        organizationName={organizationName}
        teamId={teamId}
        teamName={teamName}
        projectId={projectId}
        projectName={projectName}
        availableTeams={availableTeams}
        availableProjects={availableProjects}
        label=""
        currentOrganizationId={organizationId ?? null}
        currentTeamId={teamId ?? null}
        currentProjectId={projectId ?? null}
      />
    </VStack>
  );
}
