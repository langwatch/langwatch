import { Text, VStack } from "@chakra-ui/react";

import type {
  ModelProviderScopeType,
  ScopeSelection,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";
import { ProviderScopeChips } from "./ProviderScopeChips";
import { ScopeChipPicker } from "./ScopeChipPicker";

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

/**
 * Model-provider scope picker.
 *
 * For NEW providers, renders quick-add chips at the top ("This project",
 * "This team", "Organization") followed by the shared `ScopeChipPicker`
 * for the multi-select case. Each chip replaces the current selection
 * with exactly that single scope — the most common setup is "one scope
 * per credential", and the picker stays available below for cross-team
 * or multi-project setups.
 *
 * For EXISTING providers the section is read-only: scope changes on a
 * persisted credential happen by delete + recreate so we never silently
 * re-parent a credential across orgs/teams.
 *
 * Personal-account projects (no org/team context) render nothing.
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
  availableTeams?: Array<{ id: string; name: string }>;
  availableProjects?: Array<{ id: string; name: string; teamId?: string }>;
}) {
  const isExisting = Boolean(provider.id);
  const hasOrgOrTeam = Boolean(organizationId ?? teamId);

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

  // Dropdown-only: the Organization / This team / This project /
  // Multiple quick-pick chips were redundant in practice and have been
  // dropped from both the provider drawer and the default-models
  // override drawer. The dropdown already surfaces every reachable
  // scope. The chip variant is preserved on `ScopeChipPicker`
  // (`showQuickPicks` prop) for future surfaces where the chip-row UX
  // makes sense.
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
