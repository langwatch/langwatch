/**
 * What the project picker offers: the pure reading behind `ProjectPicker`, kept
 * apart so the filter and the pick outcome are tested without rendering.
 */

/** A team and the projects the picker offers under it, as the caller resolved them. */
export interface ProjectPickerGroup {
  team: {
    teamId: string;
    orgId: string;
    label: string;
    canCreateProject?: boolean;
  };
  projects: {
    projectId: string;
    label: string;
    /** Where picking the project leads; the caller decides it. */
    href: string;
    /** An aggregate project (ADR-177), marked in the list. */
    isAggregate?: boolean;
  }[];
}

export interface ProjectPickerItem {
  value: string;
  label: string;
  teamId: string;
  href: string | null;
  /** What the filter matches against: the team name plus the project name. */
  searchText: string;
  kind: "project" | "new-project";
  isAggregate?: boolean;
}

/** Every entry the groups offer, the per-team "New Project" included. */
export function projectPickerItems(groups: readonly ProjectPickerGroup[]): ProjectPickerItem[] {
  return groups.flatMap((group) => [
    ...group.projects.map((project) => ({
      value: project.projectId,
      label: project.label,
      teamId: group.team.teamId,
      href: project.href,
      searchText: `${group.team.label} ${project.label}`.toLowerCase(),
      kind: "project" as const,
      isAggregate: project.isAggregate,
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
 * The entries a query keeps. A running search offers projects only, so Enter on
 * the first match can never land on a create entry.
 */
export function filterProjectPickerItems({
  items,
  query,
}: {
  items: readonly ProjectPickerItem[];
  query: string;
}): ProjectPickerItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => item.kind === "project" && item.searchText.includes(needle));
}

/** A team with the entries the query kept under it; a team left with none is dropped. */
export interface ProjectPickerVisibleGroup {
  team: ProjectPickerGroup["team"];
  items: ProjectPickerItem[];
}

export function groupProjectPickerItems({
  groups,
  items,
}: {
  groups: readonly ProjectPickerGroup[];
  items: readonly ProjectPickerItem[];
}): ProjectPickerVisibleGroup[] {
  return groups
    .map((group) => ({
      team: group.team,
      items: items.filter((item) => item.teamId === group.team.teamId),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * What picking a value means: opening a project, starting the create flow for a
 * team, or nothing (the current project, or a value that left the list).
 */
export function resolveProjectPick({
  value,
  items,
  groups,
  currentProjectId,
}: {
  value: string;
  items: readonly ProjectPickerItem[];
  groups: readonly ProjectPickerGroup[];
  currentProjectId: string;
}):
  | { kind: "create"; team: { teamId: string; orgId: string } }
  | { kind: "open"; href: string }
  | null {
  const item = items.find((candidate) => candidate.value === value);
  if (!item) return null;
  if (item.kind === "new-project") {
    const team = groups.find((group) => group.team.teamId === item.teamId)?.team;
    return team ? { kind: "create", team: { teamId: team.teamId, orgId: team.orgId } } : null;
  }
  if (item.value === currentProjectId || !item.href) return null;
  return { kind: "open", href: item.href };
}
