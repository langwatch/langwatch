import {
  createInitialUIState,
  type DatasetColumn,
  type DatasetReference,
  type EvaluationsV3State,
  ExperimentEvaluationInputError,
  ExperimentRunLoopUnavailableError,
  extractPersistedState,
  type FindOrCreateWorkflowExperimentInput,
  generateHumanReadableId,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  type Entry,
  type Field,
  type StudioWorkflow as WorkflowDSL,
  type WorkflowEvaluationRequest,
  type WorkflowEvaluationStarted,
  WorkflowNotFoundError,
  WorkflowVersionRequiredError,
} from "@langwatch/workflow-contract";

import type { ExperimentV3RunLoop } from "../app/experiment-workbench.members.ts";
import type { WorkflowEvaluationRequestedEventData } from "../eventing/experiment-run-events.process.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import { runLoopOf, runProgressOf } from "../rules/experiment-run-loop.rules.ts";
import { getRunUrl } from "../rules/experiment-run-url.rules.ts";
import { requestedRunIsUntouched } from "../rules/experiment-workflow-evaluation.rules.ts";
import type {
  ExperimentWorkflowDsl,
  ExecutionDataServices,
  LoadedExecutionData,
} from "./experiment-execution-data.service.ts";
import { ExperimentExecutionDataService } from "./experiment-execution-data.service.ts";
import { ExperimentPollingRunService } from "./experiment-polling-run.service.ts";
import type { ExperimentRunCommandDispatcherService } from "./experiment-run-command-dispatcher.service.ts";
import { ExperimentRunOrchestratorService } from "./experiment-run-orchestrator.service.ts";
import type { ExperimentRunErrorReporting } from "./experiment-run-results-writer.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

export type WorkflowEvaluationParameters = Record<string, string | number | boolean>;

const logger = createLogger("langwatch:experiment:workflow-evaluation");

// Stable ids for the single workflow target + dataset of a workflow experiment.
const WORKFLOW_TARGET_ID = "workflow-target";
const WORKFLOW_DATASET_ID = "workflow-dataset";

/**
 * Runs a studio workflow as an evaluations-v3 evaluation. The single
 * backend execution path, shared with the evaluations-v3 run API.
 */
export type WorkflowEvaluationDependencies = {
  experiments: Pick<ExperimentService, "findOrCreateForWorkflow">;
  /** The workflow rows and versions this run reads, which it does not own. */
  workflowSource: ExperimentWorkflowDsl;
  /** The datasets, prompts, agents and evaluators the load reads through. */
  services: ExecutionDataServices;
  /** The run loop and its progress store, as this process composed them. */
  runLoop: ExperimentV3RunLoop;
  /** Where the request is sent for the worker to run. */
  requests: Pick<ExperimentRunCommandDispatcherService, "requestWorkflowEvaluation">;
  /** The deployment's public base URL, for the shareable results link. */
  baseUrl: string | undefined;
  errorReporting?: ExperimentRunErrorReporting;
};

/** The workflow, the version and the loaded rows one evaluation runs over. */
type PreparedEvaluation = {
  workflow: { id: string; name: string };
  version: { id: string; version: string };
  state: EvaluationsV3State;
  dataResult: LoadedExecutionData;
};

type WorkflowEvaluationInputs = Pick<
  WorkflowEvaluationRequest,
  "projectId" | "workflowId" | "versionId" | "data" | "datasetId" | "parameters"
>;

export class WorkflowEvaluationService {
  private constructor(private readonly dependencies: WorkflowEvaluationDependencies) {}

  static create(dependencies: WorkflowEvaluationDependencies): WorkflowEvaluationService {
    return new WorkflowEvaluationService(dependencies);
  }

  /** Refuses what it can, registers the run and sends it to the worker. */
  async request(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted> {
    const baseUrl = this.#baseUrl();
    const progress = runProgressOf(this.dependencies.runLoop);
    const { workflow, version, state, dataResult } = await this.prepare(input);
    const experiment = await this.findOrCreateExperiment({
      projectId: input.projectId,
      workflow,
      state,
    });
    const runId = generateHumanReadableId();
    const total = ExperimentRunOrchestratorService.countScopedCells({
      state,
      datasetRows: dataResult.datasetRows,
      scope: input.rowIndices ? { type: "rows", rowIndices: input.rowIndices } : { type: "full" },
    });

    await progress.createRun({
      runId,
      projectId: input.projectId,
      experimentId: experiment.id,
      experimentSlug: experiment.slug,
      total,
    });
    await this.dependencies.requests.requestWorkflowEvaluation({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      runId,
      experimentId: experiment.id,
      experimentSlug: experiment.slug,
      projectSlug: input.projectSlug,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      total,
      ...(input.data ? { data: input.data } : {}),
      ...(input.datasetId ? { datasetId: input.datasetId } : {}),
      ...(input.parameters ? { parameters: input.parameters } : {}),
      ...(input.rowIndices ? { rowIndices: input.rowIndices } : {}),
    });

    return {
      runId,
      runUrl: getRunUrl({
        baseUrl,
        projectSlug: input.projectSlug,
        experimentSlug: experiment.slug,
        runId,
      }),
      workflowVersionId: version.id,
      version: version.version,
    };
  }

  /** Runs a requested evaluation to its end, once: a redelivery finds the run already touched. */
  async run(request: WorkflowEvaluationRequestedEventData & { tenantId: string }): Promise<void> {
    const progress = runProgressOf(this.dependencies.runLoop);
    if (!requestedRunIsUntouched(await progress.findRunState(request.runId))) {
      logger.info({ runId: request.runId }, "Requested evaluation already ran; skipping");
      return;
    }

    let started: { ports: ExperimentRunCollaborators; prepared: PreparedEvaluation };
    try {
      started = {
        ports: runLoopOf(this.dependencies.runLoop).ports,
        prepared: await this.prepare({
          projectId: request.tenantId,
          workflowId: request.workflowId,
          versionId: request.workflowVersionId,
          data: request.data,
          datasetId: request.datasetId,
          parameters: request.parameters,
        }),
      };
    } catch (error) {
      await ExperimentPollingRunService.failRegistered({
        error,
        runId: request.runId,
        experimentSlug: request.experimentSlug,
        projectId: request.tenantId,
        progress,
        ...(this.dependencies.errorReporting
          ? { errorReporting: this.dependencies.errorReporting }
          : {}),
      });
      return;
    }
    const { ports, prepared } = started;
    const { state, dataResult } = prepared;

    await ExperimentPollingRunService.runRegistered({
      runId: request.runId,
      projectId: request.tenantId,
      projectSlug: request.projectSlug,
      experimentId: request.experimentId,
      experimentSlug: request.experimentSlug,
      scope: request.rowIndices
        ? { type: "rows", rowIndices: request.rowIndices }
        : { type: "full" },
      state,
      datasetRows: dataResult.datasetRows,
      datasetColumns: dataResult.datasetColumns,
      loadedPrompts: dataResult.loadedPrompts,
      loadedAgents: dataResult.loadedAgents,
      ports,
      workflows: this.dependencies.runLoop.workflows,
      loadedEvaluators: dataResult.loadedEvaluators,
      loadedWorkflows: dataResult.loadedWorkflows,
      defaultConcurrency: this.dependencies.runLoop.defaultConcurrency,
      baseUrl: this.#baseUrl(),
      progress,
      ...(this.dependencies.errorReporting
        ? { errorReporting: this.dependencies.errorReporting }
        : {}),
    });
  }

  /** Loads what one evaluation runs over, or refuses it. */
  private async prepare({
    projectId,
    workflowId,
    versionId,
    data,
    datasetId,
    parameters,
  }: WorkflowEvaluationInputs): Promise<PreparedEvaluation> {
    const workflow = await this.dependencies.workflowSource.findEvaluableWorkflow({
      projectId,
      workflowId,
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId, projectId);
    }

    const version = await this.dependencies.workflowSource.findEvaluableVersion({
      projectId,
      workflowId,
      ...(versionId ? { versionId } : {}),
    });
    if (!version) {
      throw new WorkflowVersionRequiredError();
    }

    const dsl = version.dsl as unknown as WorkflowDSL;
    const entry = dsl.nodes.find((n) => n.type === "entry")?.data as Entry | undefined;
    const target = WorkflowEvaluationService.workflowTarget({
      workflow,
      version,
      entryFields: entry?.outputs ?? [],
      parameters,
    });

    // Dataset precedence: caller data, then caller dataset id, then the workflow's attached
    // dataset — a saved id loads fresh, and an inline one rides as the reference.
    const { resolvedDatasetId, datasetRef } =
      data || datasetId
        ? { resolvedDatasetId: datasetId, datasetRef: emptyDatasetRef(workflow.name) }
        : WorkflowEvaluationService.attachedDataset({ entry, workflowName: workflow.name });

    const dataResult = await ExperimentExecutionDataService.loadExecutionData({
      projectId,
      dataset: datasetRef,
      targets: [target],
      evaluators: [],
      services: this.dependencies.services,
      inputs: { data, datasetId: resolvedDatasetId, parameters },
    });
    if ("error" in dataResult) {
      throw new ExperimentEvaluationInputError({
        status: dataResult.status,
        reason: dataResult.error,
      });
    }

    const state = WorkflowEvaluationService.evaluationState({
      workflowName: workflow.name,
      target,
      datasetColumns: dataResult.datasetColumns as DatasetColumn[],
      resolvedDatasetId,
    });

    return { workflow, version, state, dataResult };
  }

  /** The experiment this workflow's runs live under, found or started. */
  private findOrCreateExperiment({
    projectId,
    workflow,
    state,
  }: {
    projectId: string;
    workflow: { id: string; name: string };
    state: EvaluationsV3State;
  }): Promise<{ id: string; slug: string }> {
    return this.dependencies.experiments.findOrCreateForWorkflow({
      projectId,
      workflowId: workflow.id,
      name: workflow.name,
      workbenchState: extractPersistedState(
        state,
      ) as FindOrCreateWorkflowExperimentInput["workbenchState"],
    });
  }

  #baseUrl(): string {
    const baseUrl = this.dependencies.baseUrl;
    if (!baseUrl) {
      throw new ExperimentRunLoopUnavailableError("public address for the run's results link");
    }

    return baseUrl;
  }

  /**
   * The workflow as one evaluation target. Each input maps to the dataset column of the same name,
   * so rows and parameter overrides flow into the run; a parameter the workflow does not declare
   * as an entry field is added as an input of its own, or the mapping would never read its column.
   */
  private static workflowTarget({
    workflow,
    version,
    entryFields,
    parameters,
  }: {
    workflow: { id: string; name: string };
    version: { id: string };
    entryFields: Field[];
    parameters?: WorkflowEvaluationParameters;
  }): TargetConfig {
    const declaredIdentifiers = new Set(entryFields.map((f) => f.identifier));
    const parameterFields: Field[] = Object.keys(parameters ?? {})
      .filter((key) => !declaredIdentifiers.has(key))
      .map((key) => ({ identifier: key, type: "str" }));
    const inputFields: Field[] = [...entryFields, ...parameterFields];

    return {
      id: WORKFLOW_TARGET_ID,
      type: "workflow",
      workflowId: workflow.id,
      workflowVersionId: version.id,
      inputs: inputFields,
      outputs: [],
      mappings: {
        [WORKFLOW_DATASET_ID]: Object.fromEntries(
          inputFields.map((field) => [
            field.identifier,
            {
              type: "source" as const,
              source: "dataset" as const,
              sourceId: WORKFLOW_DATASET_ID,
              sourceField: field.identifier,
            },
          ]),
        ),
      },
    };
  }

  /** The run's starting state: one dataset, one target, no evaluators, results still running. */
  private static evaluationState({
    workflowName,
    target,
    datasetColumns,
    resolvedDatasetId,
  }: {
    workflowName: string;
    target: TargetConfig;
    datasetColumns: DatasetColumn[];
    resolvedDatasetId: string | undefined;
  }): EvaluationsV3State {
    return {
      name: workflowName,
      // The persisted dataset reference reflects what was actually evaluated, so the results page
      // renders the right columns.
      datasets: [
        WorkflowEvaluationService.persistedDatasetRef({
          workflowName,
          columns: datasetColumns,
          resolvedDatasetId,
        }),
      ],
      activeDatasetId: WORKFLOW_DATASET_ID,
      targets: [target],
      evaluators: [],
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
  }

  /** The workflow's own dataset: by id when saved, inline when the entry node carries it. */
  private static attachedDataset({
    entry,
    workflowName,
  }: {
    entry: Entry | undefined;
    workflowName: string;
  }): { resolvedDatasetId: string | undefined; datasetRef: DatasetReference } {
    if (entry?.dataset?.id && !entry.dataset.inline) {
      return { resolvedDatasetId: entry.dataset.id, datasetRef: emptyDatasetRef(workflowName) };
    }

    if (!entry?.dataset?.inline) {
      return { resolvedDatasetId: undefined, datasetRef: emptyDatasetRef(workflowName) };
    }

    const columns: DatasetColumn[] = entry.dataset.inline.columnTypes.map((c) => ({
      id: c.name,
      name: c.name,
      type: c.type,
    }));

    return {
      resolvedDatasetId: undefined,
      datasetRef: {
        id: WORKFLOW_DATASET_ID,
        name: entry.dataset.name ?? workflowName,
        type: "inline",
        inline: { columns, records: entry.dataset.inline.records as Record<string, string[]> },
        columns,
      },
    };
  }

  /** The dataset reference stored on the run, saved when an id resolved and inline otherwise. */
  private static persistedDatasetRef({
    workflowName,
    columns,
    resolvedDatasetId,
  }: {
    workflowName: string;
    columns: DatasetColumn[];
    resolvedDatasetId: string | undefined;
  }): DatasetReference {
    return resolvedDatasetId
      ? {
          id: WORKFLOW_DATASET_ID,
          name: workflowName,
          type: "saved",
          datasetId: resolvedDatasetId,
          columns,
        }
      : {
          id: WORKFLOW_DATASET_ID,
          name: workflowName,
          type: "inline",
          inline: { columns, records: {} },
          columns,
        };
  }
}

/** The placeholder dataset a run starts from when nothing is attached yet. */
function emptyDatasetRef(workflowName: string): DatasetReference {
  return {
    id: WORKFLOW_DATASET_ID,
    name: workflowName,
    type: "inline",
    inline: { columns: [], records: {} },
    columns: [],
  };
}
