/**
 * Shared scope filter component used by both the Model Providers settings
 * page and the API Keys settings page.
 *
 * Renders an "All you can see" toggle in the table header that opens a
 * dropdown with three quick choices ("All you can see" / "This Team" /
 * "This Project") plus a "More Scopes ▸" submenu that lists every org,
 * team, and project the caller can manage.
 *
 * `value` is the active filter; `onChange` swaps it. The component is
 * presentational only — it does not own any state.
 */

import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Building2, ChevronDown, Folder, Users } from "lucide-react";
import { useState } from "react";
import { Menu } from "~/components/ui/menu";

export type ScopeFilter =
  | { kind: "all" }
  | { kind: "team-current" }
  | { kind: "project-current" }
  | {
      kind: "specific";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
      name: string;
    };

export interface AvailableScopes {
  organization?: { id: string; name: string } | null;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; teamId?: string | null }>;
}

interface Props {
  value: ScopeFilter;
  onChange: (next: ScopeFilter) => void;
  available: AvailableScopes;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}

/**
 * Presentational scope filter dropdown. Shared between the model-providers
 * and api-keys settings pages. Both pages lift their available-scopes
 * derivation into `useAvailableScopes(organization)`.
 */
export function ScopeFilter({
  value,
  onChange,
  available,
  currentTeamId,
  currentProjectId,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const label = filterLabel(value, available, currentTeamId, currentProjectId);

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="sm"
          variant="outline"
          data-testid="default-models-scope-filter"
        >
          <HStack gap={1}>
            <Text>{label}</Text>
            <ChevronDown size={14} />
          </HStack>
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="240px">
        <Menu.Item
          value="all"
          onClick={() => onChange({ kind: "all" })}
          data-testid="filter-all"
        >
          All you can see
        </Menu.Item>
        {currentTeamId && (
          <Menu.Item
            value="this-team"
            onClick={() => onChange({ kind: "team-current" })}
            data-testid="filter-this-team"
          >
            This Team
          </Menu.Item>
        )}
        {currentProjectId && (
          <Menu.Item
            value="this-project"
            onClick={() => onChange({ kind: "project-current" })}
            data-testid="filter-this-project"
          >
            This Project
          </Menu.Item>
        )}
        <Menu.Item
          value="more"
          closeOnSelect={false}
          onClick={() => setMoreOpen((v) => !v)}
          data-testid="filter-more-scopes"
        >
          <HStack justify="space-between" width="full">
            <Text>More Scopes</Text>
            <ChevronDown
              size={14}
              style={{
                transform: moreOpen ? "rotate(0)" : "rotate(-90deg)",
                transition: "transform 100ms",
              }}
            />
          </HStack>
        </Menu.Item>
        {moreOpen && (
          <Box paddingLeft={2} paddingY={1}>
            {available.organization && (
              <ScopeOptionItem
                icon={<Building2 size={14} />}
                label={available.organization.name}
                hint="Organization"
                onClick={() =>
                  onChange({
                    kind: "specific",
                    scopeType: "ORGANIZATION",
                    scopeId: available.organization!.id,
                    name: available.organization!.name,
                  })
                }
              />
            )}
            {available.teams.map((t) => (
              <ScopeOptionItem
                key={`TEAM:${t.id}`}
                icon={<Users size={14} />}
                label={t.name}
                hint="Team"
                onClick={() =>
                  onChange({
                    kind: "specific",
                    scopeType: "TEAM",
                    scopeId: t.id,
                    name: t.name,
                  })
                }
              />
            ))}
            {available.projects.map((p) => (
              <ScopeOptionItem
                key={`PROJECT:${p.id}`}
                icon={<Folder size={14} />}
                label={p.name}
                hint="Project"
                onClick={() =>
                  onChange({
                    kind: "specific",
                    scopeType: "PROJECT",
                    scopeId: p.id,
                    name: p.name,
                  })
                }
              />
            ))}
          </Box>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

function ScopeOptionItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      value={`${hint}:${label}`}
      onClick={onClick}
      data-testid={`filter-scope-${hint.toLowerCase()}-${label.toLowerCase()}`}
    >
      <HStack gap={2}>
        {icon}
        <Text>{label}</Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      </HStack>
    </Menu.Item>
  );
}

function filterLabel(
  filter: ScopeFilter,
  available: AvailableScopes,
  currentTeamId?: string | null,
  currentProjectId?: string | null,
): string {
  if (filter.kind === "all") return "All you can see";
  if (filter.kind === "team-current") {
    const team = available.teams.find((t) => t.id === currentTeamId);
    return team ? `Team: ${team.name}` : "This Team";
  }
  if (filter.kind === "project-current") {
    const project = available.projects.find((p) => p.id === currentProjectId);
    return project ? `Project: ${project.name}` : "This Project";
  }
  const prefix =
    filter.scopeType === "ORGANIZATION"
      ? "Organization"
      : filter.scopeType === "TEAM"
        ? "Team"
        : "Project";
  return `${prefix}: ${filter.name}`;
}
