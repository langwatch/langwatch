import { Building2, ChevronDown, Folder, Users } from "lucide-react";
import { useRef, useState } from "react";

import { Box, Button, HStack, Text } from "../../primitives.ts";
import { SearchInput } from "../forms/search-input.tsx";
import { Menu } from "../overlays/menu.tsx";
import { NamedScope } from "./scope-name-badge.tsx";

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

/** How an option or the trigger reads: "Team" then the name as a badge, or plain words alone. */
type ScopeLabel = { kind: string; name?: string };

/** Focuses More Scopes' search as it mounts; a stable ref, so later renders leave focus alone. */
function focusWhenOpened(input: HTMLInputElement | null) {
  input?.focus();
}

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
  const [moreQuery, setMoreQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // Like the project search: typing highlights the first match, so Enter picks it.
  const changeMoreQuery = (next: string) => {
    setMoreQuery(next);
    setHighlighted(next.trim() ? firstScopeItemValue({ available, query: next }) : null);
  };

  const label = filterLabel({ filter: value, available, currentTeamId, currentProjectId });
  const currentTeam = available.teams.find((team) => team.id === currentTeamId);
  const currentProject = available.projects.find((project) => project.id === currentProjectId);
  const thisTeamLabel = namedOr({ kind: "Team", name: currentTeam?.name, fallback: "This Team" });
  const thisProjectLabel = namedOr({
    kind: "Project",
    name: currentProject?.name,
    fallback: "This Project",
  });
  const otherProjects = available.projects.filter((project) => project.id !== currentProjectId);
  const moreScopes = {
    organization:
      available.organization && namesMatch({ name: available.organization.name, query: moreQuery })
        ? available.organization
        : null,
    teams: available.teams.filter((team) => namesMatch({ name: team.name, query: moreQuery })),
    projects: available.projects.filter((project) =>
      namesMatch({ name: project.name, query: moreQuery }),
    ),
  };
  const noMoreScopes =
    !moreScopes.organization && moreScopes.teams.length === 0 && moreScopes.projects.length === 0;

  return (
    <Menu.Root
      highlightedValue={highlighted}
      onHighlightChange={({ highlightedValue }) => setHighlighted(highlightedValue)}
      onOpenChange={({ open }) => {
        if (!open) changeMoreQuery("");
      }}
    >
      <Menu.Trigger asChild>
        <Button size="sm" variant="outline" data-testid="scope-filter">
          <HStack gap={1} minWidth={0}>
            <ScopeLabelText label={label} badgeMaxWidth="10rem" />
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
            <ScopeLabelText label={thisTeamLabel} />
          </Menu.Item>
        )}
        {currentProjectId && otherProjects.length === 0 && (
          <Menu.Item
            value="this-project"
            onClick={() => onChange({ kind: "project-current" })}
            data-testid="filter-this-project"
          >
            <ScopeLabelText label={thisProjectLabel} />
          </Menu.Item>
        )}
        {otherProjects.length > 0 && (
          <ProjectSubmenu
            thisProjectLabel={currentProjectId ? thisProjectLabel : null}
            currentProjectId={currentProject?.id ?? null}
            projects={currentProject ? [currentProject, ...otherProjects] : otherProjects}
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
            <Box paddingX={2} paddingBottom={1}>
              <SearchInput
                size="sm"
                variant="flushed"
                ref={focusWhenOpened}
                placeholder="Search scopes…"
                aria-label="Search scopes"
                value={moreQuery}
                onChange={(event) => changeMoreQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (!MENU_KEYS.has(event.key)) event.stopPropagation();
                }}
                data-testid="filter-more-search"
                containerProps={{ width: "full" }}
              />
            </Box>
            {moreScopes.organization && (
              <ScopeOptionItem
                icon={<Building2 size={14} />}
                label={moreScopes.organization.name}
                hint="Organization"
                onClick={() =>
                  onChange({
                    kind: "specific",
                    scopeType: "ORGANIZATION",
                    scopeId: moreScopes.organization!.id,
                    name: moreScopes.organization!.name,
                  })
                }
              />
            )}
            {moreScopes.teams.map((team) => (
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
            {moreScopes.projects.map((project) => (
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
            {noMoreScopes && (
              <Text
                paddingX={2}
                paddingY={1.5}
                fontSize="sm"
                color="fg.muted"
                data-testid="filter-more-search-empty"
              >
                No scopes match
              </Text>
            )}
          </Box>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

// Keys the menu itself handles; every other key edits the search text.
const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Escape"]);

/** True when the name contains the query, ignoring case; an empty query matches all. */
function namesMatch({ name, query }: { name: string; query: string }): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

/** The kind and, when known, the name as a badge; or a plain label when no name is known. */
function namedOr({
  kind,
  name,
  fallback,
}: {
  kind: string;
  name: string | undefined;
  fallback: string;
}): ScopeLabel {
  return name ? { kind, name } : { kind: fallback };
}

/** A label as it reads: "Team [Platform]"; a long name truncates, whole on hover. */
function ScopeLabelText({
  label,
  badgeMaxWidth = "14rem",
}: {
  label: ScopeLabel;
  badgeMaxWidth?: string;
}) {
  if (!label.name) return <Text>{label.kind}</Text>;
  return <NamedScope kind={label.kind} name={label.name} maxWidth={badgeMaxWidth} />;
}

/** Opens to the side: "This project", then every project (current first), narrowed by name. */
function ProjectSubmenu({
  thisProjectLabel,
  currentProjectId,
  projects,
  onChange,
}: {
  thisProjectLabel: ScopeLabel | null;
  currentProjectId: string | null;
  projects: AvailableScopes["projects"];
  onChange: (next: ScopeFilterValue) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const matchesOf = (text: string) =>
    projects.filter((project) => namesMatch({ name: project.name, query: text }));
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
        <ScopeLabelText label={thisProjectLabel ?? { kind: "Projects" }} />
      </Menu.TriggerItem>
      <Menu.Content
        minWidth="240px"
        onKeyDown={(event) => {
          // Typing anywhere in the submenu goes to the search box.
          const typed = /^\S$/u.test(event.key) && !event.ctrlKey && !event.metaKey;
          if (typed && event.target !== searchRef.current) searchRef.current?.focus();
        }}
      >
        {thisProjectLabel && (
          <Menu.Item
            value="this-project"
            onClick={() => onChange({ kind: "project-current" })}
            data-testid="filter-this-project"
          >
            <ScopeLabelText label={thisProjectLabel} />
          </Menu.Item>
        )}
        <Box paddingX={2} paddingY={1}>
          <SearchInput
            ref={searchRef}
            size="sm"
            variant="flushed"
            placeholder="Search projects…"
            aria-label="Search projects"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (!MENU_KEYS.has(event.key)) event.stopPropagation();
            }}
            data-testid="filter-project-search"
            containerProps={{ width: "full" }}
          />
        </Box>
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
                {project.id === currentProjectId && (
                  <Text fontSize="xs" color="fg.muted">
                    Current
                  </Text>
                )}
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

function scopeItemValue({ hint, label }: { hint: string; label: string }): string {
  return `${hint}:${label}`;
}

/** The More Scopes row a query lands on first: the organization, then teams, then projects. */
function firstScopeItemValue({
  available,
  query,
}: {
  available: AvailableScopes;
  query: string;
}): string | null {
  const matches = (name: string) => namesMatch({ name, query });
  if (available.organization && matches(available.organization.name))
    return scopeItemValue({ hint: "Organization", label: available.organization.name });
  const team = available.teams.find((candidate) => matches(candidate.name));
  if (team) return scopeItemValue({ hint: "Team", label: team.name });
  const project = available.projects.find((candidate) => matches(candidate.name));
  return project ? scopeItemValue({ hint: "Project", label: project.name }) : null;
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
      value={scopeItemValue({ hint, label })}
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
}): ScopeLabel {
  if (filter.kind === "all") return { kind: "All you can see" };
  if (filter.kind === "team-current") {
    const team = available.teams.find((candidate) => candidate.id === currentTeamId);
    return namedOr({ kind: "Team", name: team?.name, fallback: "This Team" });
  }
  if (filter.kind === "project-current") {
    const project = available.projects.find((candidate) => candidate.id === currentProjectId);
    return namedOr({ kind: "Project", name: project?.name, fallback: "This Project" });
  }
  return { kind: scopeTypePrefix(filter.scopeType), name: filter.name };
}

function scopeTypePrefix(scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"): string {
  if (scopeType === "ORGANIZATION") return "Organization";
  if (scopeType === "TEAM") return "Team";
  return "Project";
}

export * from "./scope-filter-address.ts";
