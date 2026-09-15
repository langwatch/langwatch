import { createListCollection } from "@chakra-ui/react";
import { useMemo } from "react";

/**
 * A team and the projects the picker offers under it. The same shape
 * `ProjectScopeMenu` builds for the plain menu, so the two render paths
 * cannot drift on what they offer.
 */
export interface ProjectPickGroup {
  team: {
    teamId: string;
    orgId: string;
    label: string;
    canCreateProject?: boolean;
  };
  projects: Array<{
    projectId: string;
    label: string;
    href: string;
  }>;
}

export interface ProjectPickItem {
  value: string;
  label: string;
  teamId: string;
  href: string | null;
  /** What the filter matches against: the team name plus the project name. */
  searchText: string;
  kind: "project" | "new-project";
}

function toPickItems(groups: ProjectPickGroup[]): ProjectPickItem[] {
  return groups.flatMap((group) => [
    ...group.projects.map((project) => ({
      value: project.projectId,
      label: project.label,
      teamId: group.team.teamId,
      href: project.href,
      searchText: `${group.team.label} ${project.label}`.toLowerCase(),
      kind: "project" as const,
    })),
    ...(group.team.canCreateProject
      ? [
          {
            value: `new-project:${group.team.teamId}`,
            label: "New Project",
            teamId: group.team.teamId,
            href: null,
            searchText: "",
            kind: "new-project" as const,
          },
        ]
      : []),
  ]);
}

/**
 * The items the popup offers for a query, grouped for rendering and flat
 * for the collection the keyboard walks. A running search hides the
 * create entries: they match no project, and a list of results is not
 * the place to start a different action from.
 */
export function useProjectPickItems({
  groups,
  query,
}: {
  groups: ProjectPickGroup[];
  query: string;
}) {
  const allItems = useMemo(() => toPickItems(groups), [groups]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter((item) => item.kind === "project" && item.searchText.includes(needle));
  }, [allItems, query]);

  const collection = useMemo(
    () =>
      createListCollection({
        items: filteredItems,
        itemToValue: (item) => item.value,
        itemToString: (item) => item.label,
      }),
    [filteredItems],
  );

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          team: group.team,
          items: filteredItems.filter((item) => item.teamId === group.team.teamId),
        }))
        .filter((group) => group.items.length > 0),
    [groups, filteredItems],
  );

  return { allItems, collection, visibleGroups };
}

/**
 * What picking a value means: opening a project, starting the create
 * flow for a team, or nothing (the current project, or a value that
 * left the list between render and pick).
 */
export function resolvePickOutcome({
  value,
  allItems,
  groups,
  currentProjectId,
}: {
  value: string;
  allItems: ProjectPickItem[];
  groups: ProjectPickGroup[];
  currentProjectId: string;
}):
  | { kind: "create"; team: { teamId: string; orgId: string } }
  | { kind: "open"; href: string }
  | null {
  const item = allItems.find((candidate) => candidate.value === value);
  if (!item) return null;
  if (item.kind === "new-project") {
    const team = groups.find((g) => g.team.teamId === item.teamId)?.team;
    return team ? { kind: "create", team: { teamId: team.teamId, orgId: team.orgId } } : null;
  }
  if (item.value === currentProjectId || !item.href) return null;
  return { kind: "open", href: item.href };
}
