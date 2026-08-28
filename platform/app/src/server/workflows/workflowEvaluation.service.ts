import {
  createInitialUIState,
  type DatasetColumn,
  type DatasetReference,
  type EvaluationsV3State,
  type TargetConfig,
} from "~/experiments-v3/types";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { NlpLambdaRuntime } from "~/runtime/api/nlp-lambda";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { Entry, Field, StudioWorkflow as WorkflowDSL } from "@langwatch/workflow-contract";
import { loadExecutionData } from "~/server/experiments-v3/execution/dataLoader";
import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import type { WorkflowEvaluationOutcome } from "@langwatch/platform-api";

export type WorkflowEvaluationParameters = Record<string, string | number | boolean>;

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
export class WorkflowEvaluationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly experiments: ExperimentService,
    private readonly modelProviders: ModelProviderService,
    private readonly nlpLambda: NlpLambdaRuntime,
    private readonly workflows: WorkflowService,
    private readonly defaultConcurrency: number,
  ) {}

  static create(
    prisma: PrismaClient,
    experiments: ExperimentService,
    modelProviders: ModelProviderService,
    nlpLambda: NlpLambdaRuntime,
    workflows: WorkflowService,
    defaultConcurrency: number,
  ): WorkflowEvaluationService {
    return new WorkflowEvaluationService(
      prisma,
      experiments,
      modelProviders,
      nlpLambda,
      workflows,
      defaultConcurrency,
    );
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
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, projectId, archivedAt: null },
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    const version = versionId
      ? await this.prisma.workflowVersion.findFirst({
          where: { id: versionId, workflowId, projectId },
        })
      : // Latest manual commit wins; fall back to the latest autosave so
        // a workflow that was only ever autosaved is still evaluable.
        ((await this.prisma.workflowVersion.findFirst({
          where: { workflowId, projectId, autoSaved: false },
          orderBy: { createdAt: "desc" },
        })) ??
        (await this.prisma.workflowVersion.findFirst({
          where: { workflowId, projectId },
          orderBy: { createdAt: "desc" },
        })));
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

    const dataResult = await loadExecutionData(projectId, datasetRef, [target], [], {
      data,
      datasetId: resolvedDatasetId,
      parameters,
    });
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

    const experiment = await this.experiments.findOrCreateForWorkflow({
      projectId,
      workflowId: workflow.id,
      name: workflow.name,
      workbenchState: extractPersistedState(state),
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
      modelProviders: this.modelProviders,
      nlpLambda: this.nlpLambda,
      workflows: this.workflows,
      loadedEvaluators,
      loadedWorkflows,
      defaultConcurrency: this.defaultConcurrency,
    });

    return {
      runId,
      runUrl,
      workflowVersionId: version.id,
      version: version.version,
    };
  }
}
