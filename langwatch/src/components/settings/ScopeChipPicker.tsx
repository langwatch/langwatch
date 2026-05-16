import {
  Box,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, Users } from "lucide-react";
import { useMemo } from "react";

import { Select } from "../ui/select";
import { SmallLabel } from "../SmallLabel";
import { ProviderScopeChips } from "./ProviderScopeChips";

export type ScopeChipPickerScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export interface ScopeChipPickerEntry {
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
}

interface ScopeOption {
  value: string;
  label: string;
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
}

const SCOPE_DESCRIPTION_SINGLE: Record<ScopeChipPickerScopeType, string> = {
  PROJECT: "Only this project can use this configuration.",
  TEAM: "Every project in the team inherits this configuration.",
  ORGANIZATION: "Every project in the organization inherits this configuration.",
};

function summariseSelection(scopes: ScopeChipPickerEntry[]): string {
  if (scopes.length === 0) {
    return "Pick at least one scope.";
  }
  if (scopes.length === 1) {
    return SCOPE_DESCRIPTION_SINGLE[scopes[0]!.scopeType];
  }
  const counts = scopes.reduce(
    (acc, s) => {
      acc[s.scopeType] = (acc[s.scopeType] ?? 0) + 1;
      return acc;
    },
    {} as Record<ScopeChipPickerScopeType, number>,
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

const ScopeIcon = ({ scopeType }: { scopeType: ScopeChipPickerScopeType }) => {
  if (scopeType === "ORGANIZATION") return <Building2 size={16} aria-hidden />;
  if (scopeType === "TEAM") return <Users size={16} aria-hidden />;
  return <Folder size={16} aria-hidden />;
};

/**
 * Controlled chip-based scope picker. Pure presentation: takes the active
 * scope selection and a setter, renders a grouped multi-select over the
 * organization, the teams the caller can reach, and the projects inside
 * those teams. Selected entries render as removable chips above the field.
 *
 * Extracted from the model-provider create-drawer so the role-based default
 * model lines, gateway provider bindings, and any future "pick scopes here"
 * surface can render the same primitive without inheriting the drawer's
 * form-state machinery.
 */
export function ScopeChipPicker({
  value,
  onChange,
  organizationId,
  organizationName,
  teamId,
  teamName,
  projectId,
  projectName,
  availableTeams,
  availableProjects,
  label = "Scope",
  showSummary = true,
}: {
  value: ScopeChipPickerEntry[];
  onChange: (next: ScopeChipPickerEntry[]) => void;
  organizationId: string | undefined;
  organizationName?: string;
  teamId?: string | undefined;
  teamName?: string;
  projectId?: string;
  projectName?: string;
  /** Teams the caller can pick. Falls back to `[{id:teamId, name:teamName}]`. */
  availableTeams?: Array<{ id: string; name: string }>;
  /** Projects the caller can pick. Falls back to `[{id:projectId, name:projectName}]`. */
  availableProjects?: Array<{ id: string; name: string; teamId?: string }>;
  /** Override the field label. Defaults to "Scope". */
  label?: string;
  /** When false, hides the helper "Shared across …" line below the field. */
  showSummary?: boolean;
}) {
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
    () => value.map((s) => `${s.scopeType}:${s.scopeId}`),
    [value],
  );

  return (
    <VStack align="start" width="full" gap={2}>
      <SmallLabel>{label}</SmallLabel>
      <Select.Root
        collection={collection}
        value={selectedValues}
        multiple
        onValueChange={(details) => {
          const picked = new Set(details.value);
          const next = options
            .filter((o) => picked.has(o.value))
            .map((o) => ({ scopeType: o.scopeType, scopeId: o.scopeId }));
          onChange(next);
        }}
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Pick one or more scopes">
            {() => {
              if (value.length === 0) return "Pick one or more scopes";
              // Hydrate the chips with names looked up from the picker's
              // `options` so each chip reads "LangWatch" / "Acme Team" /
              // "web-app" instead of bare "Organization" / "Team" /
              // "Project". Without this, multiple teams render as
              // identical "Team", "Team" pills — the bug rchaves caught
              // in the model-provider drawer screenshot.
              const named = value.map((v) => {
                const match = options.find(
                  (o) =>
                    o.scopeType === v.scopeType && o.scopeId === v.scopeId,
                );
                return {
                  scopeType: v.scopeType,
                  scopeId: v.scopeId,
                  name: match?.label,
                };
              });
              return <ProviderScopeChips scopes={named} />;
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
      {showSummary && (
        <Box>
          <Text fontSize="xs" color="gray.600">
            {summariseSelection(value)}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
