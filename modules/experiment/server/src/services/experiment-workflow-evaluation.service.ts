import type { WorkflowService } from "@langwatch/workflow-server";
import {
  createInitialUIState,
  type DatasetColumn,
  type DatasetReference,
  type EvaluationsV3State,
  extractPersistedState,
  type FindOrCreateWorkflowExperimentInput,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import type { Entry, Field, StudioWorkflow as WorkflowDSL } from "@langwatch/workflow-contract";
import type { ExperimentRunErrorReportingPort } from "../ports/experiment-run-error-reporting.port.ts";
import type { ExperimentRunProgressRepository } from "../repositories/experiment-run-progress.repository.ts";
import type { ExperimentWorkflowDslPort } from "../ports/experiment-workflow-dsl.port.ts";
import type { ExperimentRunPorts } from "../rules/experiment-run-input.rules.ts";
import type { ExperimentService } from "./experiment.service.ts";
import type {
  ExecutionDataServices,
  LoadedExecutionData,
} from "./experiment-execution-data.service.ts";
import { ExperimentExecutionDataService } from "./experiment-execution-data.service.ts";
import { ExperimentPollingRunService } from "./experiment-polling-run.service.ts";

export type WorkflowEvaluationParameters = Record<string, string | number | boolean>;

/**
 * What an evaluation trigger answers with.
 */
export type WorkflowEvaluationOutcome =
  | Readonly<{
      ok: true;
      runId: string;
      runUrl: string;
      workflowVersionId: string;
      version: string;
    }>
  | Readonly<{ ok: false; status: 400 | 404; error: string }>;

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} not found`);
  }
}

export class NoCommittedVersionError extends Error {
  constructor() {
    super(
      "This workflow has no committed version to evaluate. Commit a version (or run Evaluate once in the studio) first.",
    );
  }
}

/** A bad dataset reference (e.g. an unknown dataset id) the route maps to a status. */
export class EvaluationInputError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// Stable ids for the single workflow target + dataset of a workflow experiment.
const WORKFLOW_TARGET_ID = "workflow-target";
const WORKFLOW_DATASET_ID = "workflow-dataset";

/**
 * Runs a studio workflow as an evaluations-v3 evaluation. The single
 * backend execution path, shared with the evaluations-v3 run API.
 */
export type WorkflowEvaluationDependencies = {
  experiments: ExperimentService;
  /** The workflow rows and versions this run reads, which it does not own. */
  workflowSource: ExperimentWorkflowDslPort;
  /** Everything the run loop reaches outside itself. */
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
  /** The datasets, prompts, agents and evaluators the load reads through. */
  services: ExecutionDataServices;
  /** Where the run's progress is written so a poll on another process finds it. */
  progress: ExperimentRunProgressRepository;
  /** The deployment's public base URL, for the shareable results link. */
  baseUrl: string;
  defaultConcurrency: number;
  errorReporting?: ExperimentRunErrorReportingPort;
};

export class WorkflowEvaluationService {
  private constructor(private readonly dependencies: WorkflowEvaluationDependencies) {}

  static create(dependencies: WorkflowEvaluationDependencies): WorkflowEvaluationService {
    return new WorkflowEvaluationService(dependencies);
  }

  /**
   * The same trigger, as the REST boundary reads it: a run, or a refusal
   * carrying the status and the sentence the caller is answered with.
   */
  async triggerEvaluationForRest(input: {
    projectId: string;
    projectSlug: string;
    workflowId: string;
    versionId?: string;
    data?: Record<string, unknown>[];
    datasetId?: string;
    parameters?: WorkflowEvaluationParameters;
    rowIndices?: number[];
  }): Promise<WorkflowEvaluationOutcome> {
    try {
      const result = await this.triggerEvaluation(input);

      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return { ok: false, status: 404, error: "Workflow not found" };
      }

      if (error instanceof NoCommittedVersionError) {
        return { ok: false, status: 400, error: error.message };
      }

      if (error instanceof EvaluationInputError) {
        return { ok: false, status: error.status as 400 | 404, error: error.message };
      }

      throw error;
    }
  }

  async triggerEvaluation({
    projectId,
    projectSlug,
    workflowId,
    versionId,
    data,
    datasetId,
    parameters,
    rowIndices,
  }: {
    projectId: string;
    projectSlug: string;
    workflowId: string;
    versionId?: string;
    data?: Array<Record<string, unknown>>;
    datasetId?: string;
    parameters?: WorkflowEvaluationParameters;
    rowIndices?: number[];
  }): Promise<{
    runId: string;
    runUrl: string;
    workflowVersionId: string;
    version: string;
  }> {
    const workflow = await this.dependencies.workflowSource.findEvaluableWorkflow({
      projectId,
      workflowId,
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const version = await this.dependencies.workflowSource.findEvaluableVersion({
      projectId,
      workflowId,
      ...(versionId ? { versionId } : {}),
    });
    if (!version) {
      throw new NoCommittedVersionError();
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

    const dataResult = await ExperimentExecutionDataService.loadExecutionData(
      projectId,
      datasetRef,
      [target],
      [],
      this.dependencies.services,
      { data, datasetId: resolvedDatasetId, parameters },
    );
    if ("error" in dataResult) {
      throw new EvaluationInputError(dataResult.error, dataResult.status);
    }

    const state = WorkflowEvaluationService.evaluationState({
      workflowName: workflow.name,
      target,
      datasetColumns: dataResult.datasetColumns as DatasetColumn[],
      resolvedDatasetId,
    });

    const { runId, runUrl } = await this.startPollingRun({
      projectId,
      projectSlug,
      workflow,
      state,
      dataResult,
      ...(rowIndices ? { rowIndices } : {}),
    });

    return { runId, runUrl, workflowVersionId: version.id, version: version.version };
  }

  /**
   * The experiment this workflow's runs live under, and one polling run started against it. The
   * persisted state is JSON by construction, but `z.json()` does not accept a structural type
   * whose optional keys may be `undefined`, so the transport's own cast is made here too.
   */
  private async startPollingRun({
    projectId,
    projectSlug,
    workflow,
    state,
    dataResult,
    rowIndices,
  }: {
    projectId: string;
    projectSlug: string;
    workflow: { id: string; name: string };
    state: EvaluationsV3State;
    dataResult: LoadedExecutionData;
    rowIndices?: number[];
  }): Promise<{ runId: string; runUrl: string }> {
    const experiment = await this.dependencies.experiments.findOrCreateForWorkflow({
      projectId,
      workflowId: workflow.id,
      name: workflow.name,
      workbenchState: extractPersistedState(
        state,
      ) as FindOrCreateWorkflowExperimentInput["workbenchState"],
    });

    return ExperimentPollingRunService.startPollingRun({
      projectId,
      projectSlug,
      experimentId: experiment.id,
      experimentSlug: experiment.slug,
      scope: rowIndices ? { type: "rows", rowIndices } : { type: "full" },
      state,
      datasetRows: dataResult.datasetRows,
      datasetColumns: dataResult.datasetColumns,
      loadedPrompts: dataResult.loadedPrompts,
      loadedAgents: dataResult.loadedAgents,
      ports: this.dependencies.ports,
      workflows: this.dependencies.workflows,
      loadedEvaluators: dataResult.loadedEvaluators,
      loadedWorkflows: dataResult.loadedWorkflows,
      defaultConcurrency: this.dependencies.defaultConcurrency,
      baseUrl: this.dependencies.baseUrl,
      progress: this.dependencies.progress,
      ...(this.dependencies.errorReporting
        ? { errorReporting: this.dependencies.errorReporting }
        : {}),
    });
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
