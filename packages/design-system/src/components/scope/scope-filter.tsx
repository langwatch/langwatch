import { Building2, ChevronDown, Folder, Search, Users } from "lucide-react";
import { useRef, useState } from "react";

import { Box, Button, HStack, Icon, Input, Text } from "../../primitives.ts";
import { Menu } from "../overlays/menu.tsx";

// Read-side scope filter; read-only twin of picker; presentational only.

/** The organization, teams and projects a reader may narrow the page to. */
export interface AvailableScopes {
  organization?: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId?: string | null }[];
}

/**
 * The active filter. `team-current` and `project-current` are deliberately
 * not the same as a `specific` pick: they follow the reader's ambient
 * scope, so one still means "wherever I am" after a project switch.
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

  const label = filterLabel({ filter: value, available, currentTeamId, currentProjectId });
  const otherProjects = available.projects.filter((project) => project.id !== currentProjectId);

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
        {currentProjectId && otherProjects.length === 0 && (
          <Menu.Item
            value="this-project"
            onClick={() => onChange({ kind: "project-current" })}
            data-testid="filter-this-project"
          >
            This Project
          </Menu.Item>
        )}
        {otherProjects.length > 0 && (
          <ProjectSubmenu
            hasCurrentProject={Boolean(currentProjectId)}
            projects={otherProjects}
            onChange={onChange}
          />
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

// Keys the menu itself handles; every other key edits the search text.
const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Escape"]);

/** Opens to the side: the current project first, then every other one, narrowed by name. */
function ProjectSubmenu({
  hasCurrentProject,
  projects,
  onChange,
}: {
  hasCurrentProject: boolean;
  projects: AvailableScopes["projects"];
  onChange: (next: ScopeFilterValue) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const matchesOf = (text: string) => {
    const wanted = text.trim().toLowerCase();
    if (!wanted) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(wanted));
  };
  const matching = matchesOf(query);

  const changeQuery = (next: string) => {
    setQuery(next);
    const first = matchesOf(next)[0];
    setHighlighted(next.trim() && first ? projectItemValue(first.id) : null);
  };

  return (
    <Menu.Root
      positioning={{ placement: "right-start", gutter: 2 }}
      typeahead={false}
      highlightedValue={highlighted}
      onHighlightChange={({ highlightedValue }) => setHighlighted(highlightedValue)}
      onOpenChange={({ open }) => {
        if (!open) changeQuery("");
      }}
    >
      <Menu.TriggerItem value="projects" data-testid="filter-project-submenu">
        {hasCurrentProject ? "This Project" : "Projects"}
      </Menu.TriggerItem>
      <Menu.Content
        minWidth="240px"
        onKeyDown={(event) => {
          // Typing anywhere in the submenu goes to the search box.
          const typed = /^\S$/u.test(event.key) && !event.ctrlKey && !event.metaKey;
          if (typed && event.target !== searchRef.current) searchRef.current?.focus();
        }}
      >
        {hasCurrentProject && (
          <Menu.Item
            value="this-project"
            onClick={() => onChange({ kind: "project-current" })}
            data-testid="filter-this-project"
          >
            This Project
          </Menu.Item>
        )}
        <HStack gap={1.5} paddingX={2} paddingY={1}>
          <Icon color="fg.subtle" boxSize={3.5}>
            <Search />
          </Icon>
          <Input
            ref={searchRef}
            size="xs"
            variant="flushed"
            placeholder="Search projects…"
            aria-label="Search projects"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!MENU_KEYS.has(event.key)) event.stopPropagation();
            }}
            data-testid="filter-project-search"
          />
        </HStack>
        <Box maxHeight="280px" overflowY="auto">
          {matching.map((project) => (
            <Menu.Item
              key={project.id}
              value={projectItemValue(project.id)}
              onClick={() =>
                onChange({
                  kind: "specific",
                  scopeType: "PROJECT",
                  scopeId: project.id,
                  name: project.name,
                })
              }
              data-testid={`filter-project-option-${project.id}`}
            >
              <HStack gap={2}>
                <Folder size={14} />
                <Text>{project.name}</Text>
              </HStack>
            </Menu.Item>
          ))}
        </Box>
        {matching.length === 0 && (
          <Text
            paddingX={2}
            paddingY={1.5}
            fontSize="sm"
            color="fg.muted"
            data-testid="filter-project-search-empty"
          >
            No projects match
          </Text>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

function projectItemValue(projectId: string): string {
  return `project:${projectId}`;
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

function filterLabel({
  filter,
  available,
  currentTeamId,
  currentProjectId,
}: {
  filter: ScopeFilterValue;
  available: AvailableScopes;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}): string {
  if (filter.kind === "all") return "All you can see";
  if (filter.kind === "team-current") {
    const team = available.teams.find((candidate) => candidate.id === currentTeamId);
    return team ? `Team: ${team.name}` : "This Team";
  }
  if (filter.kind === "project-current") {
    const project = available.projects.find((candidate) => candidate.id === currentProjectId);
    return project ? `Project: ${project.name}` : "This Project";
  }
  return `${scopeTypePrefix(filter.scopeType)}: ${filter.name}`;
}

function scopeTypePrefix(scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"): string {
  if (scopeType === "ORGANIZATION") return "Organization";
  if (scopeType === "TEAM") return "Team";
  return "Project";
}

export * from "./scope-filter-address.ts";
