import {
  createInitialUIState,
  type DatasetColumn,
  type DatasetReference,
  type EvaluationsV3State,
  extractPersistedState,
  type ExperimentService,
  type FindOrCreateWorkflowExperimentInput,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import type {
  Entry,
  Field,
  StudioWorkflow as WorkflowDSL,
  WorkflowService,
} from "@langwatch/workflow-contract";
import type { ExperimentRunErrorReportingPort } from "../ports/experiment-run-error-reporting.port";
import type { ExperimentRunProgressPort } from "../ports/experiment-run-progress.port";
import type { ExperimentWorkflowDslPort } from "../ports/experiment-workflow-dsl.port";
import type { ExperimentRunPorts } from "./experiment-run-orchestrator.service";
import type { ExecutionDataServices } from "./experiment-execution-data.service";
import { loadExecutionData } from "./experiment-execution-data.service";
import { startPollingRun } from "./experiment-polling-run.service";

export type WorkflowEvaluationParameters = Record<string, string | number | boolean>;

/**
 * What an evaluation trigger answers with.
 *
 * Restated structurally rather than imported: the Workflow REST family owns the
 * same shape as the contract of its own trigger, and a core feature server may
 * not depend on another feature's server. A refusal is a value rather than an
 * exception on purpose — the three ways a trigger can be refused are named by
 * this module's own error classes just below, and the mapping stays beside them
 * rather than in a catch that recognises classes by identity across a package
 * boundary.
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
 * Runs a studio workflow as an evaluations-v3 evaluation. It resolves the
 * committed version, ensures the workflow's backing experiment exists, loads
 * the dataset (the workflow's attached dataset, or caller-supplied data /
 * dataset id / parameters), and starts the v3 orchestrator, returning the run
 * id and a results URL. This is the single backend execution path, shared with
 * the evaluations-v3 run API.
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
  progress: ExperimentRunProgressPort;
  /** The deployment's public base URL, for the shareable results link. */
  baseUrl: string;
  defaultConcurrency: number;
  errorReporting?: ExperimentRunErrorReportingPort;
};

export class WorkflowEvaluationService {
  private constructor(
    private readonly dependencies: WorkflowEvaluationDependencies,
  ) {}

  static create(
    dependencies: WorkflowEvaluationDependencies,
  ): WorkflowEvaluationService {
    return new WorkflowEvaluationService(dependencies);
  }

  /**
   * The same trigger, as the REST boundary reads it: a run, or a refusal
   * carrying the status and the sentence the caller is answered with.
   *
   * The three refusals are named by this module's own error classes, so the
   * mapping lives beside them rather than in a transport that would have to
   * recognise them by identity across a package boundary. Anything else is
   * rethrown and degrades to an unknown error with a trace id, which is what
   * an infrastructure failure should do.
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
    const workflow = await this.dependencies.workflowSource.tryFindEvaluableWorkflow({
      projectId,
      workflowId,
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const version = await this.dependencies.workflowSource.tryFindEvaluableVersion({
      projectId,
      workflowId,
      ...(versionId ? { versionId } : {}),
    });
    if (!version) {
      throw new NoCommittedVersionError();
    }

    const dsl = version.dsl as unknown as WorkflowDSL;
    const entry = dsl.nodes.find((n) => n.type === "entry")?.data as Entry | undefined;
    const entryFields: Field[] = entry?.outputs ?? [];

    // A parameter the workflow does not already declare as an entry field still
    // has to reach the nodes: it is added as a dataset column (see
    // applyParametersToRows), so it needs a matching input + mapping or
    // buildTargetInputs would never read the column.
    const declaredIdentifiers = new Set(entryFields.map((f) => f.identifier));
    const parameterFields: Field[] = Object.keys(parameters ?? {})
      .filter((key) => !declaredIdentifiers.has(key))
      .map((key) => ({ identifier: key, type: "str" }));
    const inputFields: Field[] = [...entryFields, ...parameterFields];

    // The workflow target maps each workflow input to the dataset column of the
    // same name, so dataset rows (and parameter overrides) flow into the run.
    const target: TargetConfig = {
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

    // Dataset precedence: caller data > caller dataset id > the workflow's
    // attached dataset (a saved id loads fresh; inline rides as the reference).
    let resolvedDatasetId = datasetId;
    let datasetRef: DatasetReference = {
      id: WORKFLOW_DATASET_ID,
      name: workflow.name,
      type: "inline",
      inline: { columns: [], records: {} },
      columns: [],
    };
    if (!data && !datasetId) {
      if (entry?.dataset?.id && !entry.dataset.inline) {
        resolvedDatasetId = entry.dataset.id;
      } else if (entry?.dataset?.inline) {
        const columns: DatasetColumn[] = entry.dataset.inline.columnTypes.map((c) => ({
          id: c.name,
          name: c.name,
          type: c.type,
        }));
        datasetRef = {
          id: WORKFLOW_DATASET_ID,
          name: entry.dataset.name ?? workflow.name,
          type: "inline",
          inline: {
            columns,
            records: entry.dataset.inline.records as Record<string, string[]>,
          },
          columns,
        };
      }
    }

    const dataResult = await loadExecutionData(
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

    const {
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    } = dataResult;

    // The persisted dataset reference reflects what was actually evaluated so
    // the results page renders the right columns.
    const persistedColumns = datasetColumns as DatasetColumn[];
    const resolvedDatasetRef: DatasetReference = resolvedDatasetId
      ? {
          id: WORKFLOW_DATASET_ID,
          name: workflow.name,
          type: "saved",
          datasetId: resolvedDatasetId,
          columns: persistedColumns,
        }
      : {
          id: WORKFLOW_DATASET_ID,
          name: workflow.name,
          type: "inline",
          inline: { columns: persistedColumns, records: {} },
          columns: persistedColumns,
        };

    const state: EvaluationsV3State = {
      name: workflow.name,
      datasets: [resolvedDatasetRef],
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

    const experiment = await this.dependencies.experiments.findOrCreateForWorkflow({
      projectId,
      workflowId: workflow.id,
      name: workflow.name,
      // The same cast the feature's own transport makes: the persisted state is
      // JSON by construction, and `z.json()` does not accept a structural type
      // whose optional keys may be `undefined`.
      workbenchState: extractPersistedState(
        state,
      ) as FindOrCreateWorkflowExperimentInput["workbenchState"],
    });

    const { runId, runUrl } = await startPollingRun({
      projectId,
      projectSlug,
      experimentId: experiment.id,
      experimentSlug: experiment.slug,
      scope: rowIndices ? { type: "rows", rowIndices } : { type: "full" },
      state,
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      ports: this.dependencies.ports,
      workflows: this.dependencies.workflows,
      loadedEvaluators,
      loadedWorkflows,
      defaultConcurrency: this.dependencies.defaultConcurrency,
      baseUrl: this.dependencies.baseUrl,
      progress: this.dependencies.progress,
      ...(this.dependencies.errorReporting
        ? { errorReporting: this.dependencies.errorReporting }
        : {}),
    });

    return {
      runId,
      runUrl,
      workflowVersionId: version.id,
      version: version.version,
    };
  }
}
