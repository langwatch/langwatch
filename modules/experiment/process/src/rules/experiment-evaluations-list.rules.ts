import type { Experiment, ExperimentEvaluationsListRow } from "@langwatch/experiment-contract";
import { studioWorkflowSchema } from "@langwatch/workflow-contract";

/** The dataset a workflow's entry node draws from, when it names one. */
export const extractDatasetId = (dsl: unknown): string | undefined => {
  const parsed = studioWorkflowSchema.safeParse(dsl);
  if (!parsed.success) return undefined;
  const entry = parsed.data.nodes.find((node) => node.type === "entry");

  return (entry?.data as { dataset?: { id?: string } } | undefined)?.dataset?.id;
};

/** The most recently created run in a list, or undefined for an empty list. */
export function pickLatestRun<T extends { timestamps: { createdAt: number } }>(
  runs: readonly T[],
): T | undefined {
  return runs.slice().toSorted((a, b) => b.timestamps.createdAt - a.timestamps.createdAt)[0];
}

/** The fields of an experiment the evaluations list draws; its saved state shrinks to the task. */
export const evaluationsListRowOf = (
  experiment: Experiment,
): Omit<ExperimentEvaluationsListRow, "runsSummary" | "dataset" | "updatedAt"> => ({
  id: experiment.id,
  name: experiment.name,
  type: experiment.type,
  slug: experiment.slug,
  projectId: experiment.projectId,
  workflowId: experiment.workflowId,
  createdAt: experiment.createdAt,
  archivedAt: experiment.archivedAt,
  workbenchState: workbenchTaskOf(experiment.workbenchState),
});

/** A saved workbench state reduced to its task; null when the state is empty or falsy. */
const workbenchTaskOf = (
  state: Experiment["workbenchState"],
): ExperimentEvaluationsListRow["workbenchState"] => {
  if (!state) return null;
  if (typeof state !== "object" || Array.isArray(state)) return {};
  return typeof state.task === "string" ? { task: state.task } : {};
};
