/** Whether the experiment lookup query should be enabled.
 *
 * After #2330 this no longer requires in-memory evaluationState — the
 * slug-based lookup works whenever a workflowId is available, which
 * persists across page refreshes.
 */
export function isExperimentQueryEnabled({
  hasProject,
  workflowId,
}: {
  hasProject: boolean;
  workflowId: string | undefined;
}): boolean {
  return hasProject && !!workflowId;
}
