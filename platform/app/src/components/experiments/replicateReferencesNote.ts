/**
 * The note the replicate dialog shows about prompts, evaluators and agents.
 * Within one project they are shared with the original; in another project
 * they are not copied. Nothing is shown until a target is picked.
 */
export const replicateReferencesNote = ({
  sourceProjectId,
  targetProjectId,
}: {
  sourceProjectId: string | undefined;
  targetProjectId: string | undefined;
}): string | undefined => {
  if (!targetProjectId) return undefined;
  if (targetProjectId === sourceProjectId) {
    return "Prompts, evaluators and agents are shared with the original. Editing them in the copy also changes the original.";
  }
  return "Prompts, evaluators and agents are not copied. The copy needs them to exist in the target project.";
};
