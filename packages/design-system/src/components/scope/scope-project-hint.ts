/**
 * Telling same-name projects apart in a scope picker (issue #9734).
 * Spec: specs/components/scope-picker-same-name-projects.feature
 */

/** A project as a scope picker lists it. `hint` names what sets it apart, e.g. its owner. */
export type ScopeProjectChoice = {
  id: string;
  name: string;
  teamId?: string | null;
  hint?: string;
};

type NamedTeam = { id: string; name: string };

/** The badge of a personal workspace: "Alex Rivera (you)" for the reader's own, else "Sam Lee". */
export function personalWorkspaceHint({
  ownerName,
  isViewer,
}: {
  ownerName: string;
  isViewer: boolean;
}): string {
  return isViewer ? `${ownerName} (you)` : ownerName;
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * The badge text per project id, for projects whose name another listed project
 * shares: the caller's hint, else the project's team. A unique name, or one with
 * nothing to tell it apart, gets no entry.
 */
export function sameNameHints({
  projects,
  teams,
}: {
  projects: readonly ScopeProjectChoice[];
  teams: readonly NamedTeam[];
}): Map<string, string> {
  const countByName = new Map<string, number>();
  for (const project of projects) {
    const key = nameKey(project.name);
    countByName.set(key, (countByName.get(key) ?? 0) + 1);
  }
  const teamNameById = new Map(teams.map((team) => [team.id, team.name] as const));
  const hints = new Map<string, string>();
  for (const project of projects) {
    if ((countByName.get(nameKey(project.name)) ?? 0) < 2) continue;
    const hint = project.hint ?? teamNameById.get(project.teamId ?? "");
    if (hint) hints.set(project.id, hint);
  }
  return hints;
}

/** What a search matches a project on, lower-cased: its name, its hint and its team's name. */
export function projectSearchText({
  project,
  teams,
}: {
  project: ScopeProjectChoice;
  teams: readonly NamedTeam[];
}): string {
  const teamName = teams.find((team) => team.id === project.teamId)?.name;
  return [project.name, project.hint, teamName].filter(Boolean).join(" ").toLocaleLowerCase();
}
