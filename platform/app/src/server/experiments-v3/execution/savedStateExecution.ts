import type { z } from "zod";
import {
  type BoardResults,
  planBoardCarryOver,
  planComparisonSeeding,
  type SeedableResults,
  type SeedTargetOutputs,
} from "~/experiments-v3/execution/buildExecutionRequest";
import type { EvaluationsV3State } from "~/experiments-v3/types";
import { createInitialUIState } from "~/experiments-v3/types";
import { persistedEvaluationsV3StateSchema } from "~/experiments-v3/types/persistence";
import type { CellId } from "~/experiments-v3/utils/executionScope";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import {
  ExperimentNotFoundError,
  type ExperimentService,
  InvalidExperimentConfigurationError,
} from "@langwatch/experiment-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { type ExecutionDataInputs, loadExecutionData } from "./dataLoader";
import type { CarriedOverCell, ExecutionScope } from "./types";

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
  return Object.keys(seedTargetOutputs).length > 0 ? seedTargetOutputs : undefined;
};

/**
 * The board cells a run with no page attached carries rather than produces.
 *
 * Its board is the saved workbench state, which is the only board there is
 * when no tab is open. A full run carries nothing, because it covers every
 * cell itself; a run given a row subset carries the rows it leaves alone.
 */
export const planSavedRunCarryOver = ({
  prepared,
  scope,
  extraCells,
}: {
  prepared: SavedStateExecution;
  scope: ExecutionScope;
  extraCells?: CellId[];
}): CarriedOverCell[] =>
  planBoardCarryOver({
    targets: prepared.state.targets,
    scope,
    datasetRows: prepared.datasetRows,
    results: prepared.workbenchState.results as Partial<BoardResults>,
    ...(extraCells ? { extraCells } : {}),
  });

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
  dataset: z.infer<typeof persistedEvaluationsV3StateSchema>["datasets"][number];
};

/**
 * Read the experiment's saved state and the dataset the run is pinned to.
 *
 * Kept apart from the loader below so each half answers one question: this one
 * is only about what was stored and whether it can be run at all.
 */
async function readSavedWorkbench({
  experiments,
  projectId,
  slug,
}: {
  experiments: ExperimentService;
  projectId: string;
  slug: string;
}): Promise<SavedWorkbench | SavedStateExecutionRefusal> {
  const experiment = await experiments.tryGetBySlugAndType({
    projectId,
    slug,
    type: "EVALUATIONS_V3",
  });
  if (!experiment) {
    throw new ExperimentNotFoundError(slug);
  }

  const parseResult = persistedEvaluationsV3StateSchema.safeParse(experiment.workbenchState);
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
  experiments,
  evaluators,
  projectId,
  slug,
  runInputs,
}: {
  experiments: ExperimentService;
  evaluators: EvaluatorService;
  projectId: string;
  slug: string;
  runInputs?: ExecutionDataInputs;
}): Promise<SavedStateExecution | SavedStateExecutionRefusal> {
  const saved = await readSavedWorkbench({ experiments, projectId, slug });
  if ("error" in saved) {
    return saved;
  }
  const { experimentId, workbenchState, dataset } = saved;

  const dataResult = await loadExecutionData(
    projectId,
    dataset,
    workbenchState.targets,
    workbenchState.evaluators,
    runInputs ?? {},
    { evaluators },
  );
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
