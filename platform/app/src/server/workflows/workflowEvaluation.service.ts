import type { PrismaClient, WorkflowVersion } from "@prisma/client";
import {
  createInitialUIState,
  type DatasetColumn,
  type DatasetReference,
  type EvaluationsV3State,
  type TargetConfig,
} from "~/experiments-v3/types";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import type {
  Entry,
  Field,
  Workflow as WorkflowDSL,
} from "~/optimization_studio/types/dsl";
import { ExperimentService } from "~/server/experiments/experiment.service";
import {
  type LoadedExecutionData,
  loadExecutionData,
} from "~/server/experiments-v3/execution/dataLoader";
import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import type { ExecutionScope } from "~/server/experiments-v3/execution/types";

export type WorkflowEvaluationParameters = Record<
  string,
  string | number | boolean
>;

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
 * A parameter the workflow does not already declare as an entry field still
 * has to reach the nodes: it is added as a dataset column (see
 * applyParametersToRows), so it needs a matching input + mapping or
 * buildTargetInputs would never read the column.
 */
function buildInputFields({
  entryFields,
  parameters,
}: {
  entryFields: Field[];
  parameters?: WorkflowEvaluationParameters;
}): Field[] {
  const declaredIdentifiers = new Set(entryFields.map((f) => f.identifier));
  const parameterFields: Field[] = Object.keys(parameters ?? {})
    .filter((key) => !declaredIdentifiers.has(key))
    .map((key) => ({ identifier: key, type: "str" }));
  return [...entryFields, ...parameterFields];
}

/**
 * The workflow target maps each workflow input to the dataset column of the
 * same name, so dataset rows (and parameter overrides) flow into the run.
 */
function buildWorkflowTarget({
  workflowId,
  workflowVersionId,
  inputFields,
}: {
  workflowId: string;
  workflowVersionId: string;
  inputFields: Field[];
}): TargetConfig {
  return {
    id: WORKFLOW_TARGET_ID,
    type: "workflow",
    workflowId,
    workflowVersionId,
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

function emptyDatasetRef(workflowName: string): DatasetReference {
  return {
    id: WORKFLOW_DATASET_ID,
    name: workflowName,
    type: "inline",
    inline: { columns: [], records: {} },
    columns: [],
  };
}

/**
 * Dataset precedence: caller data > caller dataset id > the workflow's
 * attached dataset (a saved id loads fresh; inline rides as the reference).
 */
function resolveInitialDataset({
  workflowName,
  entry,
  data,
  datasetId,
}: {
  workflowName: string;
  entry: Entry | undefined;
  data?: Array<Record<string, unknown>>;
  datasetId?: string;
}): { resolvedDatasetId: string | undefined; datasetRef: DatasetReference } {
  if (data || datasetId) {
    return {
      resolvedDatasetId: datasetId,
      datasetRef: emptyDatasetRef(workflowName),
    };
  }
  if (entry?.dataset?.id && !entry.dataset.inline) {
    return {
      resolvedDatasetId: entry.dataset.id,
      datasetRef: emptyDatasetRef(workflowName),
    };
  }
  if (entry?.dataset?.inline) {
    const columns: DatasetColumn[] = entry.dataset.inline.columnTypes.map(
      (c) => ({
        id: c.name,
        name: c.name,
        type: c.type,
      }),
    );
    return {
      resolvedDatasetId: datasetId,
      datasetRef: {
        id: WORKFLOW_DATASET_ID,
        name: entry.dataset.name ?? workflowName,
        type: "inline",
        inline: {
          columns,
          records: entry.dataset.inline.records as Record<string, string[]>,
        },
        columns,
      },
    };
  }
  return {
    resolvedDatasetId: datasetId,
    datasetRef: emptyDatasetRef(workflowName),
  };
}

/**
 * The persisted dataset reference reflects what was actually evaluated so
 * the results page renders the right columns.
 */
function buildPersistedDatasetRef({
  workflowName,
  resolvedDatasetId,
  columns,
}: {
  workflowName: string;
  resolvedDatasetId: string | undefined;
  columns: DatasetColumn[];
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

function buildEvaluationState({
  workflowName,
  dataset,
  target,
}: {
  workflowName: string;
  dataset: DatasetReference;
  target: TargetConfig;
}): EvaluationsV3State {
  return {
    name: workflowName,
    datasets: [dataset],
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

/**
 * Runs a studio workflow as an evaluations-v3 evaluation. It resolves the
 * committed version, ensures the workflow's backing experiment exists, loads
 * the dataset (the workflow's attached dataset, or caller-supplied data /
 * dataset id / parameters), and starts the v3 orchestrator, returning the run
 * id and a results URL. This is the single backend execution path, shared with
 * the evaluations-v3 run API.
 */
export class WorkflowEvaluationService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): WorkflowEvaluationService {
    return new WorkflowEvaluationService(prisma);
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

    const version = await this.resolveVersion({
      projectId,
      workflowId,
      versionId,
    });

    const dsl = version.dsl as unknown as WorkflowDSL;
    const entry = dsl.nodes.find((n) => n.type === "entry")?.data as
      | Entry
      | undefined;
    const target = buildWorkflowTarget({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      inputFields: buildInputFields({
        entryFields: entry?.outputs ?? [],
        parameters,
      }),
    });

    const { resolvedDatasetId, datasetRef } = resolveInitialDataset({
      workflowName: workflow.name,
      entry,
      data,
      datasetId,
    });

    const dataResult = await loadExecutionData({
      projectId,
      dataset: datasetRef,
      targets: [target],
      evaluators: [],
      inputs: { data, datasetId: resolvedDatasetId, parameters },
    });
    if ("error" in dataResult) {
      throw new EvaluationInputError(dataResult.error, dataResult.status);
    }

    const state = buildEvaluationState({
      workflowName: workflow.name,
      target,
      dataset: buildPersistedDatasetRef({
        workflowName: workflow.name,
        resolvedDatasetId,
        columns: dataResult.datasetColumns as DatasetColumn[],
      }),
    });

    const { runId, runUrl } = await this.startRun({
      projectId,
      projectSlug,
      workflow,
      state,
      scope: rowIndices ? { type: "rows", rowIndices } : { type: "full" },
      dataResult,
    });

    return {
      runId,
      runUrl,
      workflowVersionId: version.id,
      version: version.version,
    };
  }

  private async resolveVersion({
    projectId,
    workflowId,
    versionId,
  }: {
    projectId: string;
    workflowId: string;
    versionId?: string;
  }): Promise<WorkflowVersion> {
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
    return version;
  }

  /** Ensures the workflow's backing experiment exists, then starts the run. */
  private async startRun({
    projectId,
    projectSlug,
    workflow,
    state,
    scope,
    dataResult,
  }: {
    projectId: string;
    projectSlug: string;
    workflow: { id: string; name: string };
    state: EvaluationsV3State;
    scope: ExecutionScope;
    dataResult: LoadedExecutionData;
  }): Promise<{ runId: string; runUrl: string }> {
    const experiment = await ExperimentService.create(
      this.prisma,
    ).findOrCreateForWorkflow({
      projectId,
      workflowId: workflow.id,
      name: workflow.name,
      workbenchState: extractPersistedState(state),
    });

    return await startPollingRun({
      projectId,
      projectSlug,
      experimentId: experiment.id,
      experimentSlug: experiment.slug,
      scope,
      state,
      datasetRows: dataResult.datasetRows,
      datasetColumns: dataResult.datasetColumns,
      loadedPrompts: dataResult.loadedPrompts,
      loadedAgents: dataResult.loadedAgents,
      loadedEvaluators: dataResult.loadedEvaluators,
      loadedWorkflows: dataResult.loadedWorkflows,
    });
  }
}
