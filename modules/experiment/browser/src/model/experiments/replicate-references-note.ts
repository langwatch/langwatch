import type { ExperimentType } from "../prisma-types.ts";

/**
 * The replicate dialog's note on prompts, evaluators and agents: shared within
 * one project, not copied to another, nothing until a target is picked. Only
 * V3 experiments reference them by id; other types deep-copy their workflow.
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
