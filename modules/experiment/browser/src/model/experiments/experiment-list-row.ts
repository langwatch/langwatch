import type { LEGACY_EXPERIMENT_TASK_TYPES } from "@langwatch/experiment-contract";
import type { TimeInput } from "@langwatch/time";
import { z } from "zod";

import type { ExperimentType } from "../prisma-types.ts";

/** One row of the experiments list, as the list screen renders it. */
export type ExperimentListRow = {
  id: string;
  slug: string;
  name: string | null;
  type: ExperimentType;
  createdAt: TimeInput;
  updatedAt: TimeInput;
  workflowId: string | null;
  workbenchState?: { task?: keyof typeof LEGACY_EXPERIMENT_TASK_TYPES } | null;
  dataset?: { id?: string; name: string } | null;
  runsSummary: {
    count: number;
    primaryMetric?: { name: string; averageScore: number | null; averagePassed?: number } | null;
    latestRun?: {
      timestamps?: {
        createdAt?: number | null;
        finishedAt?: number | null;
        stoppedAt?: number | null;
        updatedAt?: number | null;
      } | null;
    } | null;
  };
};

export const TASK_TYPE_LABELS: Record<keyof typeof LEGACY_EXPERIMENT_TASK_TYPES, string> = {
  real_time: "Legacy live workflow",
  llm_app: "LLM app experiment",
  prompt_creation: "Prompt experiment",
  custom_evaluator: "Evaluator experiment",
  scan: "Vulnerability scan",
};

export const EXPERIMENT_TYPE_LABELS: Record<ExperimentType, string> = {
  BATCH_EVALUATION_V2: "SDK",
  BATCH_EVALUATION: "Batch experiment",
  DSPY: "DSPy optimization",
  EVALUATIONS_V3: "Workbench",
};

export const experimentTypeLabel = (experiment: ExperimentListRow): string =>
  experiment.workbenchState?.task
    ? TASK_TYPE_LABELS[experiment.workbenchState.task]
    : EXPERIMENT_TYPE_LABELS[experiment.type];

export const workbenchPathOf = (projectSlug: string, experiment: ExperimentListRow) =>
  `/${projectSlug}/experiments/workbench/${experiment.slug}`;

export const resultsPathOf = (projectSlug: string, experiment: ExperimentListRow) =>
  `/${projectSlug}/experiments/${experiment.slug}`;

/** Workbench-backed experiments (current and legacy wizard) open in the workbench. */
export const opensInWorkbench = (experiment: ExperimentListRow) =>
  experiment.type === "EVALUATIONS_V3" || !!experiment.workbenchState;

/** Where the experiment's name leads: the workbench or the results page. */
export const experimentPathOf = (projectSlug: string, experiment: ExperimentListRow) =>
  opensInWorkbench(experiment)
    ? workbenchPathOf(projectSlug, experiment)
    : resultsPathOf(projectSlug, experiment);

/** The SDK's experiments have no workbench to edit in. */
export const isEditable = (experiment: ExperimentListRow) =>
  experiment.type === "EVALUATIONS_V3" ||
  (experiment.type !== "BATCH_EVALUATION_V2" && !!experiment.workbenchState);

const workbenchDatasetsSchema = z.object({
  activeDatasetId: z.string().optional(),
  datasets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string().optional(),
      datasetId: z.string().optional(),
    }),
  ),
});

export type ListDataset = { name: string; extra: number; datasetId?: string };

/**
 * The dataset an experiment is set up with: the workflow's dataset, else the workbench's active
 * one. SDK runs record none, and nothing is guessed for them.
 */
export function datasetOfRow(experiment: ExperimentListRow): ListDataset | undefined {
  if (experiment.dataset?.name) {
    return { name: experiment.dataset.name, extra: 0, datasetId: experiment.dataset.id };
  }
  const setup = workbenchDatasetsSchema.safeParse(experiment.workbenchState);
  if (setup.success && setup.data.datasets.length > 0) {
    const { datasets, activeDatasetId } = setup.data;
    const first = datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0]!;
    return {
      name: first.name,
      extra: datasets.length - 1,
      datasetId: first.type === "saved" ? first.datasetId : undefined,
    };
  }
  return undefined;
}

export type RunStatus = "completed" | "stopped" | "running" | "none";

const RUNNING_WINDOW_MS = 5 * 60 * 1000;

/** What the latest run's timestamps say: unfinished and recently touched means running. */
export function runStatusOf({
  runsSummary,
  nowMs,
}: {
  runsSummary: ExperimentListRow["runsSummary"];
  nowMs: number;
}): RunStatus {
  const timestamps = runsSummary.latestRun?.timestamps;
  if (timestamps?.finishedAt) return "completed";
  if (timestamps?.stoppedAt) return "stopped";
  const updatedAt = timestamps?.updatedAt;
  if (updatedAt && nowMs - updatedAt < RUNNING_WINDOW_MS) return "running";
  return runsSummary.count > 0 ? "completed" : "none";
}
