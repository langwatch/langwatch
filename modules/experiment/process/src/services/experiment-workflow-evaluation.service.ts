import {
  createInitialUIState,
  type DatasetColumn,
  type DatasetReference,
  type EvaluationsV3State,
  ExperimentEvaluationInputError,
  ExperimentRunLoopUnavailableError,
  extractPersistedState,
  findOrCreateWorkflowExperimentInputSchema,
  generateHumanReadableId,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  type Entry,
  type Field,
  parseStudioWorkflow,
  type WorkflowEvaluationRequest,
  type WorkflowEvaluationStarted,
  WorkflowNotFoundError,
  WorkflowVersionRequiredError,
} from "@langwatch/workflow-contract";

import type { WorkflowEvaluationRequestedEventData } from "../eventing/experiment-run-events.process.ts";
import type { ExperimentRunFoldRepository } from "../repositories/experiment-run-fold.repository.ts";
import type { ExperimentRunRefusals } from "../rules/experiment-run-availability.rules.ts";
import { getRunUrl } from "../rules/experiment-run-url.rules.ts";
import {
  persistedDatasetRef,
  requestedRunIsUntouched,
  WORKFLOW_DATASET_ID,
} from "../rules/experiment-workflow-evaluation.rules.ts";
import { ExperimentCellPlanService } from "./experiment-cell-plan.service.ts";
import type {
  ExperimentWorkflowDsl,
  ExecutionDataServices,
  LoadedExecutionData,
} from "./experiment-execution-data.service.ts";
import { ExperimentExecutionDataService } from "./experiment-execution-data.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import type { ExperimentRunCommandDispatcherService } from "./experiment-run-command-dispatcher.service.ts";
import { ExperimentRunPlanService } from "./experiment-run-plan.service.ts";
import type { ExperimentRunErrorReporting } from "./experiment-run-results-writer.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

export type WorkflowEvaluationParameters = Record<string, string | number | boolean>;

const logger = createLogger("langwatch:experiment:workflow-evaluation");

// Stable id for the single workflow target of a workflow experiment.
const WORKFLOW_TARGET_ID = "workflow-target";

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
  /** Cells in flight at once for a run (`EVAL_V3_CONCURRENCY`). */
  concurrency: number;
  /** The run's progress fold: a start answers once it holds the run, and a redelivery reads it. */
  folds: ExperimentRunFoldRepository;
  /** What this process refuses of a run, for want of Redis or a public address. */
  refusals: ExperimentRunRefusals;
  /** Where the request is sent for the worker, and where the worker starts or fails the run. */
  requests: Pick<
    ExperimentRunCommandDispatcherService,
    "requestWorkflowEvaluation" | "startExperimentRun" | "completeExperimentRun"
  >;
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

  /** Refuses what it can, sends the run to the worker and records its start, then answers. */
  async request(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted> {
    this.#refuseRead();
    const baseUrl = this.#baseUrl();
    const { workflow, version, state, dataResult } = await this.prepare(input);
    const experiment = await this.findOrCreateExperiment({
      projectId: input.projectId,
      workflow,
      state,
    });
    const runId = generateHumanReadableId();
    const total = ExperimentCellPlanService.create().countScopedCells({
      state,
      datasetRows: dataResult.datasetRows,
      scope: input.rowIndices ? { type: "rows", rowIndices: input.rowIndices } : { type: "full" },
    });

    const occurredAt = nowInstant().epochMilliseconds;
    await this.dependencies.requests.requestWorkflowEvaluation({
      tenantId: input.projectId,
      occurredAt,
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
    // Answered once the command is written; a poll before the worker folds it reads this start.
    await this.dependencies.folds.recordRunStart({
      start: {
        projectId: input.projectId,
        runId,
        experimentId: experiment.id,
        total,
        startedAt: occurredAt,
      },
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

  /** Plans a requested evaluation and starts it on the run's pipeline, once; a refusal fails it. */
  async run(request: WorkflowEvaluationRequestedEventData & { tenantId: string }): Promise<void> {
    this.#refuseRead();
    const read = await this.dependencies.folds.readRunProgress({ runId: request.runId });
    const folded = read.kind === "folded" ? read.state : undefined;
    if (!requestedRunIsUntouched({ state: folded, experimentId: request.experimentId })) {
      logger.info({ runId: request.runId }, "Requested evaluation already ran; skipping");
      return;
    }

    let started: { prepared: PreparedEvaluation; runUrl: string };
    try {
      started = {
        prepared: await this.prepare({
          projectId: request.tenantId,
          workflowId: request.workflowId,
          versionId: request.workflowVersionId,
          data: request.data,
          datasetId: request.datasetId,
          parameters: request.parameters,
        }),
        runUrl: getRunUrl({
          baseUrl: this.#baseUrl(),
          projectSlug: request.projectSlug,
          experimentSlug: request.experimentSlug,
          runId: request.runId,
        }),
      };
    } catch (error) {
      await this.failRequested({ request, error });
      return;
    }
    const { prepared, runUrl } = started;
    const { state, dataResult } = prepared;
    const plan = ExperimentRunPlanService.create().buildPlan({
      request: {
        state,
        scope: request.rowIndices
          ? { type: "rows", rowIndices: request.rowIndices }
          : { type: "full" },
      },
      data: dataResult,
      concurrency: this.dependencies.concurrency,
      origin: "workflow",
      persistResults: false,
      experimentSlug: request.experimentSlug,
      runUrl,
    });

    await this.dependencies.requests.startExperimentRun({
      tenantId: request.tenantId,
      occurredAt: nowInstant().epochMilliseconds,
      runId: request.runId,
      experimentId: request.experimentId,
      workflowVersionId: prepared.version.id,
      total: plan.cells.length,
      targets: ExperimentResultDispatchService.create().buildTargetMetadata({
        targets: state.targets,
        loadedPrompts: dataResult.loadedPrompts,
        loadedAgents: dataResult.loadedAgents,
        loadedEvaluators: dataResult.loadedEvaluators,
        loadedWorkflows: dataResult.loadedWorkflows,
      }),
      plan,
    });
  }

  /** A request the worker cannot prepare completes failed, with the refusal when it is handled. */
  private async failRequested({
    request,
    error,
  }: {
    request: WorkflowEvaluationRequestedEventData & { tenantId: string };
    error: unknown;
  }): Promise<void> {
    const { runId, experimentSlug, tenantId: projectId } = request;
    logger.error({ error, runId, experimentSlug, projectId }, "Execution error");
    this.dependencies.errorReporting?.captureException(error, {
      extra: { runId, experimentSlug, projectId },
    });

    await this.dependencies.requests.completeExperimentRun({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      runId,
      experimentId: request.experimentId,
      outcome: "failed",
      total: request.total,
      ...(HandledError.isHandled(error) ? { error: error.serialize() } : {}),
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

    const dsl = parseStudioWorkflow(version.dsl);
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

    const dataResult = await ExperimentExecutionDataService.create().loadExecutionData({
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
      // Stored as JSON, so an absent field is dropped, as main's row write dropped it.
      workbenchState: findOrCreateWorkflowExperimentInputSchema.shape.workbenchState.parse(
        JSON.parse(JSON.stringify(extractPersistedState(state))),
      ),
    });
  }

  /** A process without Redis could never read its runs back, as the retired run loop refused. */
  #refuseRead(): void {
    const refusal = this.dependencies.refusals.read;
    if (refusal) throw new ExperimentRunLoopUnavailableError(refusal);
  }

  #baseUrl(): string {
    const baseUrl = this.dependencies.baseUrl;
    if (!baseUrl) {
      throw new ExperimentRunLoopUnavailableError({
        capability: "public address for the run's results link",
      });
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
        persistedDatasetRef({
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
