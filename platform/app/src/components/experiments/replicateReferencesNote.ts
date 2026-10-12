import type { ExperimentType } from "~/generated/prisma/client";

/**
 * The note the replicate dialog shows about prompts, evaluators and agents.
 * Within one project they are shared with the original; in another project
 * they are not copied. Nothing is shown until a target is picked. Only V3
 * experiments reference them by id; other types deep-copy their workflow.
 */
export const replicateReferencesNote = ({
  experimentType,
  sourceProjectId,
  targetProjectId,
}: {
  experimentType: ExperimentType;
  sourceProjectId: string | undefined;
  targetProjectId: string | undefined;
}): string | undefined => {
  if (experimentType !== "EVALUATIONS_V3") return undefined;
  if (!targetProjectId) return undefined;
  if (targetProjectId === sourceProjectId) {
    return "Prompts, evaluators and agents are shared with the original. Editing them in the copy also changes the original.";
  }
  return "Prompts, evaluators and agents are not copied. The copy needs them to exist in the target project.";
};
