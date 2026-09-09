import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Building2, ChevronDown, Folder, Users } from "lucide-react";
import { useState } from "react";

/**
 * Which scope a settings page is LOOKING AT, as opposed to which scopes a rule
 * is written to.
 *
 * The read-side twin of `ScopeChipPicker`, harvested from
 * `platform/app/src/components/settings/ScopeFilter.tsx` with its one platform
 * seam substituted: `AvailableScopes` was declared in `~/hooks/useAvailableScopes`
 * and is declared here instead, because a surface may not reach an application.
 * The platform copy stays for the four settings pages that still render it —
 * model providers, API keys, default models — and dies with the last of them.
 *
 * It lives beside the picker rather than in a surface of its own for the reason
 * that surface's own docblock gives: a page that offers scope selection also
 * shows what is selected, and every consumer of one is a consumer of the other.
 *
 * Presentational only. `value` is the active filter and `onChange` swaps it;
 * the component owns no state but the submenu's open flag.
 */

/** The organization, teams and projects a reader may narrow the page to. */
export interface AvailableScopes {
  organization?: { id: string; name: string } | null;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; teamId?: string | null }>;
}

/**
 * The active filter.
 *
 * `team-current` and `project-current` are deliberately not the same as a
 * `specific` pick of the same scope: they follow the reader's ambient scope, so
 * an address carrying one still means "wherever I am" after a project switch.
 */
export type ScopeFilterValue =
  | { kind: "all" }
  | { kind: "team-current" }
  | { kind: "project-current" }
  | {
      kind: "specific";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
      name: string;
    };

export function ScopeFilter({
  value,
  onChange,
  available,
  currentTeamId,
  currentProjectId,
}: {
  value: ScopeFilterValue;
  onChange: (next: ScopeFilterValue) => void;
  available: AvailableScopes;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const label = filterLabel(value, available, currentTeamId, currentProjectId);

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" variant="outline" data-testid="scope-filter">
          <HStack gap={1}>
            <Text>{label}</Text>
            <ChevronDown size={14} />
          </HStack>
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="240px">
        <Menu.Item value="all" onClick={() => onChange({ kind: "all" })} data-testid="filter-all">
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
          onClick={() => setMoreOpen((open) => !open)}
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
            {available.teams.map((team) => (
              <ScopeOptionItem
                key={`TEAM:${team.id}`}
                icon={<Users size={14} />}
                label={team.name}
                hint="Team"
                onClick={() =>
                  onChange({
                    kind: "specific",
                    scopeType: "TEAM",
                    scopeId: team.id,
                    name: team.name,
                  })
                }
              />
            ))}
            {available.projects.map((project) => (
              <ScopeOptionItem
                key={`PROJECT:${project.id}`}
                icon={<Folder size={14} />}
                label={project.name}
                hint="Project"
                onClick={() =>
                  onChange({
                    kind: "specific",
                    scopeType: "PROJECT",
                    scopeId: project.id,
                    name: project.name,
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
  filter: ScopeFilterValue,
  available: AvailableScopes,
  currentTeamId?: string | null,
  currentProjectId?: string | null,
): string {
  if (filter.kind === "all") return "All you can see";
  if (filter.kind === "team-current") {
    const team = available.teams.find((candidate) => candidate.id === currentTeamId);
    return team ? `Team: ${team.name}` : "This Team";
  }
  if (filter.kind === "project-current") {
    const project = available.projects.find((candidate) => candidate.id === currentProjectId);
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
