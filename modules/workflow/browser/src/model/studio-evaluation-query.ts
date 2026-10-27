/** Refresh-safe gate for the slug-based experiment lookup. */
export function isExperimentQueryEnabled({
  hasProject,
  workflowId,
}: {
  hasProject: boolean;
  workflowId: string | undefined;
}): boolean {
  return hasProject && !!workflowId;
}
