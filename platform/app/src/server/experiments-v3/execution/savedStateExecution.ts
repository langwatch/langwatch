import type { z } from "zod";
import type { EvaluationsV3State } from "~/experiments-v3/types";
import { createInitialUIState } from "~/experiments-v3/types";
import { persistedEvaluationsV3StateSchema } from "~/experiments-v3/types/persistence";
import { ExperimentType } from "~/generated/prisma/client";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { prisma } from "~/server/db";
import {
  ExperimentNotFoundError,
  InvalidExperimentConfigurationError,
} from "~/server/experiments/errors";
import { ExperimentService } from "~/server/experiments/experiment.service";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { type ExecutionDataInputs, loadExecutionData } from "./dataLoader";

type LoadedExecutionData = Extract<
  Awaited<ReturnType<typeof loadExecutionData>>,
  { datasetRows: unknown }
>;

/**
 * Everything a run from the SAVED workbench state needs, resolved and loaded.
 * Shared by `POST /api/experiments/:slug/run` and the UI-action backend
 * executor, so a run started with no browser attached goes through exactly
 * the load path a CI run does.
 */
export interface SavedStateExecution {
  experiment: { id: string; slug: string };
  workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>;
  state: EvaluationsV3State;
  datasetRows: LoadedExecutionData["datasetRows"];
  datasetColumns: LoadedExecutionData["datasetColumns"];
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators: LoadedExecutionData["loadedEvaluators"];
  loadedWorkflows: LoadedExecutionData["loadedWorkflows"];
}

export interface SavedStateExecutionRefusal {
  error: string;
  status: number;
}

export const buildStateFromWorkbench = (
  workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>,
): EvaluationsV3State => {
  const dataset = workbenchState.datasets[0]!;
  return {
    name: workbenchState.name,
    datasets: workbenchState.datasets as EvaluationsV3State["datasets"],
    activeDatasetId: dataset.id ?? "dataset-1",
    targets: workbenchState.targets as EvaluationsV3State["targets"],
    evaluators: workbenchState.evaluators as EvaluationsV3State["evaluators"],
    results: {
      status: "running",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  };
};

/**
 * Resolve the experiment, parse its saved state, and load everything the
 * orchestrator needs. Throws `ExperimentNotFoundError` and
 * `InvalidExperimentConfigurationError` like the run route always has; the
 * loader's own refusals come back as `{error, status}` for the caller to map.
 */
export async function prepareSavedStateExecution({
  projectId,
  slug,
  runInputs,
}: {
  projectId: string;
  slug: string;
  runInputs?: ExecutionDataInputs;
}): Promise<SavedStateExecution | SavedStateExecutionRefusal> {
  const experiment = await ExperimentService.create(prisma).findBySlugAndType({
    projectId,
    slug,
    type: ExperimentType.EVALUATIONS_V3,
  });
  if (!experiment) {
    throw new ExperimentNotFoundError(slug);
  }

  const parseResult = persistedEvaluationsV3StateSchema.safeParse(
    experiment.workbenchState,
  );
  if (!parseResult.success) {
    // The stored state no longer matches its schema: ours, not the customer's.
    throw new InvalidExperimentConfigurationError(slug);
  }

  const workbenchState = parseResult.data;
  const dataset = workbenchState.datasets[0];
  if (!dataset) {
    return { error: "No dataset configured", status: 400 };
  }

  const dataResult = await loadExecutionData(
    projectId,
    dataset,
    workbenchState.targets,
    workbenchState.evaluators,
    runInputs ?? {},
  );
  if ("error" in dataResult) {
    return { error: dataResult.error, status: dataResult.status };
  }

  return {
    experiment: { id: experiment.id, slug },
    workbenchState,
    state: buildStateFromWorkbench(workbenchState),
    datasetRows: dataResult.datasetRows,
    datasetColumns: dataResult.datasetColumns,
    loadedPrompts: dataResult.loadedPrompts as Map<string, VersionedPrompt>,
    loadedAgents: dataResult.loadedAgents as Map<string, TypedAgent>,
    loadedEvaluators: dataResult.loadedEvaluators,
    loadedWorkflows: dataResult.loadedWorkflows,
  };
}
