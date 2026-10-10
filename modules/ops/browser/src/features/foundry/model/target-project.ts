/** The project the Foundry targets: the picked one, else the page's, else the first listed. */
export function pickTargetProject<P extends { id: string }>({
  selectedProjectId,
  currentProjectId,
  projects,
}: {
  selectedProjectId: string | null;
  currentProjectId: string | undefined;
  projects: P[];
}): P | undefined {
  const byId = (id: string | null | undefined) => projects.find((p) => p.id === id);
  return byId(selectedProjectId) ?? byId(currentProjectId) ?? projects[0];
}
