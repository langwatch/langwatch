import { Text, VStack } from "@chakra-ui/react";

import { SmallLabel } from "../SmallLabel";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
  type ScopeTriadType,
} from "../settings/ScopeChipPicker";
import { ProviderScopeChips } from "../settings/ProviderScopeChips";

export type VirtualKeyScopeType = ScopeTriadType;
export type VirtualKeyScopeEntry = ScopeTriadEntry;

const VK_SCOPE_DESCRIPTION_SINGLE: Record<VirtualKeyScopeType, string> = {
  PROJECT: "Only this project's consumers can use this key.",
  TEAM: "Every project in the team can use this key.",
  ORGANIZATION: "Every project in the organization can use this key.",
};

function summariseVkSelection(scopes: VirtualKeyScopeEntry[]): string {
  if (scopes.length === 0) {
    return "Pick at least one scope to grant the key access.";
  }
  if (scopes.length === 1) {
    return VK_SCOPE_DESCRIPTION_SINGLE[scopes[0]!.scopeType];
  }
  const counts = scopes.reduce(
    (acc, s) => {
      acc[s.scopeType] = (acc[s.scopeType] ?? 0) + 1;
      return acc;
    },
    {} as Record<VirtualKeyScopeType, number>,
  );
  const parts: string[] = [];
  if (counts.ORGANIZATION) parts.push("the organization");
  if (counts.TEAM)
    parts.push(counts.TEAM === 1 ? "1 team" : `${counts.TEAM} teams`);
  if (counts.PROJECT)
    parts.push(
      counts.PROJECT === 1 ? "1 project" : `${counts.PROJECT} projects`,
    );
  return `Usable across ${parts.join(" + ")}.`;
}

/**
 * Multi-scope picker for VirtualKey. Mirrors ModelProviderScopeSection
 * shape (iter 109): same `ScopeChipPicker` primitive, VK-specific copy.
 *
 * Read-only mode for existing VKs (`isExisting=true`) - scope changes
 * happen by delete + recreate so trace ownership never silently shifts.
 *
 * Caller is responsible for filtering `availableTeams`/`availableProjects`
 * down to those where the user holds `virtualKeys:manage` at that scope -
 * the spec's RBAC contract (vk-scope-rbac.feature) requires every chosen
 * scope to be a perm-grant the user actually holds; the picker shouldn't
 * surface unreachable scopes.
 *
 * Spec: specs/ai-gateway/governance/vk-scope-inheritance.feature,
 *       specs/ai-gateway/governance/vk-scope-rbac.feature.
 */
export function VirtualKeyScopePicker({
  scopes,
  onScopesChange,
  isExisting,
  organizationId,
  organizationName,
  teamId,
  teamName,
  projectId,
  projectName,
  availableTeams,
  availableProjects,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
}: {
  scopes: VirtualKeyScopeEntry[];
  onScopesChange: (next: VirtualKeyScopeEntry[]) => void;
  isExisting?: boolean;
  organizationId: string | undefined;
  organizationName?: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  projectName?: string;
  availableTeams?: Array<{ id: string; name: string }>;
  availableProjects?: Array<{ id: string; name: string; teamId?: string }>;
  currentOrganizationId?: string | null;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}) {
  if (isExisting) {
    return (
      <VStack align="start" width="full" gap={2}>
        <SmallLabel>Scope</SmallLabel>
        <ProviderScopeChips scopes={scopes} />
        <Text fontSize="xs" color="gray.500">
          Scope is fixed after create. To change it, delete and recreate
          at the new scope.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack align="start" width="full" gap={1.5}>
      <SmallLabel>Scope</SmallLabel>
      <ScopeChipPicker
        value={scopes}
        onChange={onScopesChange}
        organizationId={organizationId}
        organizationName={organizationName}
        teamId={teamId}
        teamName={teamName}
        projectId={projectId}
        projectName={projectName}
        availableTeams={availableTeams}
        availableProjects={availableProjects}
        label=""
        showSummary={false}
        currentOrganizationId={currentOrganizationId}
        currentTeamId={currentTeamId}
        currentProjectId={currentProjectId}
      />
    </VStack>
  );
}
