/**
 * The saved workbench a run by slug starts from: its state, the body's run inputs and the
 * data they load, with main's refusals. A run over a pinned dataset version also gets the
 * board row each of its rows writes back to (specs/experiments-v3/dataset-version-pin.feature).
 */
import {
  ExperimentEvaluationInputError,
  ExperimentNotFoundError,
  InvalidExperimentConfigurationError,
  persistedEvaluationsV3StateSchema,
  runsSavedDataset,
  type CarriedOverCell,
  type EvaluationsV3State,
  type ExecutionScope,
  type SavedRunRequest,
  type runInputsBodySchema,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import { datasetVersionAuthorFrom } from "../../../rules/experiment-workbench-actor.rules.ts";
import { ExperimentBoardRowsService } from "../../../services/experiment-board-rows.service.ts";
import type { LoadedExecutionData } from "../../../services/experiment-execution-data.service.ts";
import { ExperimentSavedStateExecutionService } from "../../../services/experiment-saved-state-execution.service.ts";
import type { ExperimentService } from "../../../services/experiment.service.ts";
import type { WorkbenchRunPipeline } from "./experiment-workbench-pipeline-run.service.ts";

const logger = createLogger("langwatch:experiments-v3");

export interface SavedRunPreparation {
  experimentId: string;
  state: EvaluationsV3State;
  data: LoadedExecutionData;
  scope: ExecutionScope;
  runInputs: z.infer<typeof runInputsBodySchema>;
  boardRowIndices?: (number | null)[];
  carriedOverCells: CarriedOverCell[];
}

export class ExperimentSavedRunPreparationService {
  private constructor(private readonly experiments: ExperimentService) {}

  static create({
    experiments,
  }: {
    experiments: ExperimentService;
  }): ExperimentSavedRunPreparationService {
    return new ExperimentSavedRunPreparationService(experiments);
  }

  async prepare({
    input,
    runs,
  }: {
    input: SavedRunRequest;
    runs: WorkbenchRunPipeline;
  }): Promise<SavedRunPreparation> {
    const { projectId, slug } = input;
    const savedExperiment = await this.experiments.findBySlugAndType({
      projectId,
      slug,
      type: "EVALUATIONS_V3",
    });
    if (!savedExperiment) throw new ExperimentNotFoundError(slug);

    const parseResult = persistedEvaluationsV3StateSchema.safeParse(savedExperiment.workbenchState);
    if (!parseResult.success) {
      logger.error({ slug, errors: parseResult.error.issues }, "Invalid workbenchState");
      throw new InvalidExperimentConfigurationError(slug);
    }
    if (!parseResult.data.datasets[0]) {
      throw new ExperimentEvaluationInputError({ status: 400, reason: "No dataset configured" });
    }
    const savedState = ExperimentSavedStateExecutionService.create();
    const runInputs = savedState.parseRunInputs({ body: input.body });
    const prepared = await savedState.prepareSavedStateExecution({
      experiments: this.experiments,
      services: runs.services,
      projectId,
      slug,
      runInputs: {
        data: runInputs.data,
        datasetId: runInputs.dataset_id,
        ...(runInputs.dataset_version !== undefined
          ? { datasetVersion: runInputs.dataset_version }
          : {}),
        by: datasetVersionAuthorFrom({ credential: input.credential }),
        parameters: runInputs.parameters,
      },
    });
    const scope: ExecutionScope = runInputs.row_indices
      ? { type: "rows", rowIndices: runInputs.row_indices }
      : { type: "full" };
    // A run over another version than the board shows writes back onto the rows with its ids.
    const boardRowIndices =
      prepared.pinnedVersionRowIds && prepared.datasetVersion && runsSavedDataset(runInputs)
        ? await ExperimentBoardRowsService.create({
            datasets: runs.services.datasets,
          }).boardRowIndices({
            projectId,
            datasetId: prepared.datasetVersion.datasetId,
            runRowIds: prepared.pinnedVersionRowIds,
          })
        : undefined;
    const data: LoadedExecutionData = {
      datasetRows: prepared.datasetRows,
      datasetColumns: prepared.datasetColumns,
      loadedPrompts: prepared.loadedPrompts,
      loadedAgents: prepared.loadedAgents,
      loadedEvaluators: prepared.loadedEvaluators,
      loadedWorkflows: prepared.loadedWorkflows,
      ...(prepared.datasetVersion ? { datasetVersion: prepared.datasetVersion } : {}),
    };
    return {
      experimentId: prepared.experiment.id,
      state: prepared.state,
      data,
      scope,
      runInputs,
      ...(boardRowIndices ? { boardRowIndices } : {}),
      carriedOverCells: savedState.planSavedRunCarryOver({
        prepared,
        scope,
        ...(boardRowIndices ? { boardRowIndices } : {}),
      }),
    };
  }
}
