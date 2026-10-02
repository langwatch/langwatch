/** The slice of `organization.getScopeGraph` the personal-workspace question reads. */
export type AnnotationScopeGraph = readonly {
  teams: readonly {
    isPersonal: boolean;
    ownerUserId: string | null;
    projects: readonly { id: string }[];
  }[];
}[];

/** Main's `team.isPersonal && team.ownerUserId === userId`, for the team holding the project. */
export function isOwnPersonalWorkspace({
  graph,
  projectId,
  userId,
}: {
  graph: AnnotationScopeGraph;
  projectId: string | undefined;
  userId: string | undefined;
}): boolean {
  if (!projectId || !userId) return false;
  const team = graph
    .flatMap((organization) => organization.teams)
    .find((candidate) => candidate.projects.some((project) => project.id === projectId));

  return !!team?.isPersonal && team.ownerUserId === userId;
}
