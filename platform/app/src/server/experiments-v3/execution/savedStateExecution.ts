import type { z } from "zod";
import {
  planComparisonSeeding,
  type SeedableResults,
  type SeedTargetOutputs,
} from "~/experiments-v3/execution/buildExecutionRequest";
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
import type { ExecutionScope } from "./types";

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

/**
 * The saved outputs a scoped run may reuse instead of producing again.
 *
 * A run with no browser attached starts from a state whose results are empty by
 * construction, so a candidate-only run had nothing for the comparison judge to
 * read for the OTHER variants and Phase 2 reported every one of them as
 * "Waiting on …". The saved cells are exactly what an open page would have
 * seeded, so the two paths read the same comparison the same way.
 */
export const planSavedRunSeeding = ({
  prepared,
  scope,
}: {
  prepared: SavedStateExecution;
  scope: ExecutionScope;
}): SeedTargetOutputs | undefined => {
  const { seedTargetOutputs } = planComparisonSeeding({
    targets: prepared.state.targets,
    evaluators: prepared.state.evaluators,
    scope,
    rowCount: prepared.datasetRows.length,
    results: prepared.workbenchState.results as SeedableResults | undefined,
  });
  return Object.keys(seedTargetOutputs).length > 0
    ? seedTargetOutputs
    : undefined;
};

export const buildStateFromWorkbench = (
  workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>,
): EvaluationsV3State => {
  return {
    name: workbenchState.name,
    datasets: workbenchState.datasets as EvaluationsV3State["datasets"],
    activeDatasetId: workbenchState.activeDatasetId,
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

/** What the stored experiment says the run covers, once it is readable. */
type SavedWorkbench = {
  experimentId: string;
  workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>;
  dataset: z.infer<
    typeof persistedEvaluationsV3StateSchema
  >["datasets"][number];
};

/**
 * Read the experiment's saved state and the dataset the run is pinned to.
 *
 * Kept apart from the loader below so each half answers one question: this one
 * is only about what was stored and whether it can be run at all.
 */
async function readSavedWorkbench({
  projectId,
  slug,
}: {
  projectId: string;
  slug: string;
}): Promise<SavedWorkbench | SavedStateExecutionRefusal> {
  const experiment = await ExperimentService.create({
    prisma,
  }).findBySlugAndType({
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
  // The run must use the dataset the saved workbench has selected. Taking the
  // first one instead executes a different dataset than the browser shows.
  const dataset = workbenchState.datasets.find(
    (candidate) => candidate.id === workbenchState.activeDatasetId,
  );
  if (!dataset) {
    return { error: "No dataset configured", status: 400 };
  }

  return { experimentId: experiment.id, workbenchState, dataset };
}

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
  const saved = await readSavedWorkbench({ projectId, slug });
  if ("error" in saved) {
    return saved;
  }
  const { experimentId, workbenchState, dataset } = saved;

  const dataResult = await loadExecutionData({
    projectId,
    dataset,
    targets: workbenchState.targets,
    evaluators: workbenchState.evaluators,
    inputs: runInputs ?? {},
  });
  if ("error" in dataResult) {
    return { error: dataResult.error, status: dataResult.status };
  }

  return {
    experiment: { id: experimentId, slug },
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
