/** The slice of `organization.getScopeGraph` that says whose workspace a project sits in. */
export type AnalyticsScopeGraph = readonly {
  teams: readonly {
    isPersonal: boolean;
    projects: readonly { id: string }[];
  }[];
}[];

/** Whether the team holding the project is a personal workspace; false until the graph names it. */
export function isPersonalProject({
  graph,
  projectId,
}: {
  graph: AnalyticsScopeGraph;
  projectId: string | undefined;
}): boolean {
  if (projectId === undefined) return false;
  return graph
    .flatMap((organization) => organization.teams)
    .some((team) => team.isPersonal && team.projects.some((project) => project.id === projectId));
}
