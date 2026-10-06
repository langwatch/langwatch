/**
 * Shared data loading utilities for Evaluations V3 execution.
 */

import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi, DatasetColumns } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  ExperimentDatasetChangedDuringReadError,
  ExperimentDatasetTooLargeToRunError,
  ExperimentDatasetTooManyRowsError,
  ExperimentEvaluationInputError,
} from "@langwatch/experiment-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi, VersionedPrompt } from "@langwatch/prompt-contract";
import {
  transposeColumnsFirstToRowsFirstWithId,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

import {
  applyParametersToRows,
  JSON_COLUMN_TYPES,
  type LoadedDataset,
  normalizeColumnIdsToNames,
  parseJsonColumns,
  rowBytesOf,
  rowsFromInlineData,
  savedDatasetPageRows,
} from "../rules/experiment-execution-data.rules.ts";
import { ExperimentTargetLoadingService } from "./experiment-target-loading.service.ts";

/**
 * The committed studio workflow a workflow target runs, once per dataset row.
 * Two narrow reads, not one "load the workflow" call, so a missing workflow
 * and one with no committed version say so differently (Postgres, off-limits).
 */
export abstract class ExperimentWorkflowDsl {
  /** The workflow, or null when the project has none by that id. */
  abstract findWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string; publishedId: string | null } | null>;
  /** The version's raw DSL, or null when the project has no such version. */
  abstract findVersionDsl(input: {
    projectId: string;
    workflowId: string;
    versionId: string;
  }): Promise<unknown>;
  /**
   * The workflow a "evaluate this workflow" call names, excluding archived
   * ones — a run of a workflow the customer has archived is a run of something
   * that is not there any more.
   */
  abstract findEvaluableWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string } | null>;
  /**
   * The version such a call evaluates: the one it named, else the latest
   * manual commit, else the latest autosave — so a workflow that was only ever
   * autosaved is still evaluable.
   */
  abstract findEvaluableVersion(input: {
    projectId: string;
    workflowId: string;
    versionId?: string;
  }): Promise<{ id: string; version: string; dsl: unknown } | null>;
}

/**
 * Flexible dataset input type that works with both runtime (DatasetReference)
 * and persisted state schemas.
 */
type DatasetInput = {
  type: "inline" | "saved";
  inline?: {
    columns: { id: string; name: string; type: string }[];
    records: Record<string, unknown[]>;
  };
  datasetId?: string;
  columns: { id: string; name: string; type: string }[];
};

/**
 * A studio workflow loaded for a workflow target: the committed DSL that is
 * run as a whole, once per dataset row.
 */
export type LoadedWorkflow = {
  id: string;
  name: string;
  versionId: string;
  dsl: StudioWorkflow;
};

/** DB evaluator rows a run has loaded, keyed by their own id. */
export type LoadedEvaluators = Map<string, { id: string; name: string; config: unknown }>;

/**
 * Result of loading all execution data.
 */
export type LoadedExecutionData = {
  datasetRows: Record<string, unknown>[];
  datasetColumns: { id: string; name: string; type: string }[];
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, Agent>;
  loadedEvaluators: Map<string, Evaluator>;
  loadedWorkflows: Map<string, LoadedWorkflow>;
};

/**
 * Target configuration for loading (simplified interface).
 */
type TargetForLoading = {
  type: string;
  promptId?: string;
  promptVersionNumber?: number;
  dbAgentId?: string;
  /** For evaluator targets: the database evaluator ID */
  targetEvaluatorId?: string;
  /** For workflow targets: the studio workflow ID and pinned version */
  workflowId?: string;
  workflowVersionId?: string;
};

/**
 * Evaluator configuration for loading (simplified interface).
 */
type EvaluatorForLoading = {
  dbEvaluatorId?: string;
};

/**
 * Optional run-time inputs that override or supply the dataset to evaluate.
 * Sent by the run API, the workflow evaluate endpoint, and the SDKs.
 */
export type ExecutionDataInputs = {
  data?: Record<string, unknown>[];
  datasetId?: string;
  parameters?: Record<string, string | number | boolean>;
};

/**
 * Canonical feature services this load reads through.
 */
export type ExecutionDataServices = {
  datasets: DatasetApi;
  prompts: PromptApi;
  agents: AgentApi;
  /** The committed studio DSL a workflow target runs, once per dataset row. */
  workflows: ExperimentWorkflowDsl;
  evaluators?: EvaluatorApi;
  /**
   * The bounds the project's organization answers: the plan's row bound for
   * rows sent with the request, and the row and byte bounds for a saved
   * dataset. The load refuses above them so the bounds hold at every entry.
   */
  entitlements: Pick<EntitlementApi, "requestBound">;
  projects: Pick<ProjectApi, "getOrganizationId">;
};

/**
 * Everything a run loads before it starts: the dataset rows, the prompts,
 * agents, workflows and evaluators its targets name.
 */
export class ExperimentExecutionDataService {
  private constructor() {}

  static create(): ExperimentExecutionDataService {
    return new ExperimentExecutionDataService();
  }

  /**
   * The dataset a workbench reference names, normalized: its inline rows, or
   * every row of the saved dataset it points at.
   */
  private async loadDataset({
    dataset,
    projectId,
    organizationId,
    services,
  }: {
    dataset: DatasetInput;
    projectId: string;
    organizationId: string;
    services: ExecutionDataServices;
  }): Promise<BaseDataset> {
    if (dataset.type === "inline" && dataset.inline) {
      const columns = dataset.inline.columns;

      // Transposed from columns-first to rows-first, then keyed by column
      // name: inline records are keyed by column id, like "input_0".
      const rows = normalizeColumnIdsToNames(
        transposeColumnsFirstToRowsFirstWithId(dataset.inline.records as Record<string, string[]>),
        columns,
      );

      return { rows: parseJsonColumns(rows, jsonColumnNames(columns)), columns, source: "inline" };
    }

    if (dataset.type === "saved" && dataset.datasetId) {
      const saved = await this.readSavedDataset({
        slugOrId: dataset.datasetId,
        projectId,
        organizationId,
        services,
      });
      const columns = dataset.columns;

      // Saved datasets already use names as keys.
      return {
        rows: parseJsonColumns(saved.rows, jsonColumnNames(columns)),
        columns,
        source: "saved",
      };
    }

    throw new ExperimentEvaluationInputError({
      status: 400,
      reason: "Invalid dataset configuration",
    });
  }

  /**
   * Every row of a saved dataset, read page by page, or a refusal: the run
   * never starts over fewer rows than the dataset has. A dataset that is not
   * ready (uploading, processing, failed) refuses the read by name.
   */
  private async readSavedDataset({
    slugOrId,
    projectId,
    organizationId,
    services,
  }: {
    slugOrId: string;
    projectId: string;
    organizationId: string;
    services: ExecutionDataServices;
  }): Promise<{ rows: Record<string, unknown>[]; columnTypes: DatasetColumns }> {
    const [maxRows, maxBytes] = await Promise.all([
      services.entitlements.requestBound({ key: "datasetRowsMax", organizationId }),
      services.entitlements.requestBound({ key: "datasetWholeReadBytes", organizationId }),
    ]);
    const head = await services.datasets.getDatasetHead({ slugOrId, projectId });
    const rowCount = head.total;
    if (rowCount > maxRows) {
      throw new ExperimentDatasetTooManyRowsError({ rowCount, maxRows });
    }

    const limit = savedDatasetPageRows(head.records.map((record) => record.entry));
    const rows: Record<string, unknown>[] = [];
    let bytes = 0;
    for (let page = 1; rows.length < rowCount; page++) {
      const read = await services.datasets.getDatasetPage({
        slugOrId: head.dataset.id,
        projectId,
        page,
        limit,
      });
      if (read.count !== rowCount || read.datasetRecords.length === 0) {
        throw new ExperimentDatasetChangedDuringReadError({ rowCount, rowsRead: rows.length });
      }
      for (const record of read.datasetRecords) {
        bytes += rowBytesOf(record.entry);
        if (bytes > maxBytes) {
          throw new ExperimentDatasetTooLargeToRunError({ maxBytes });
        }
        rows.push(record.entry);
      }
    }
    if (rows.length !== rowCount) {
      throw new ExperimentDatasetChangedDuringReadError({ rowCount, rowsRead: rows.length });
    }

    return { rows, columnTypes: head.dataset.columnTypes };
  }

  /**
   * Everything a run needs before its first row: the dataset and every prompt, agent, workflow and
   * evaluator its targets name. A missing target is refused with an ExperimentEvaluationInputError,
   * so a deleted target stops the run instead of emptying a column.
   */
  async loadExecutionData({
    projectId,
    dataset,
    targets,
    evaluators,
    services,
    inputs,
  }: {
    projectId: string;
    dataset: DatasetInput;
    targets: TargetForLoading[];
    evaluators: EvaluatorForLoading[];
    services: ExecutionDataServices;
    inputs?: ExecutionDataInputs;
  }): Promise<LoadedExecutionData> {
    const organizationId = await services.projects.getOrganizationId(projectId);
    const baseDataset = await this.resolveBaseDataset({
      projectId,
      organizationId,
      dataset,
      services,
      inputs,
    });

    // Rows sent with the request answer the plan's row bound, which holds here
    // for rows a transport let through. Refused, not truncated: a run over a
    // silently shortened dataset reports success over the wrong rows.
    if (baseDataset.source === "inline") {
      const maxRows = await services.entitlements.requestBound({
        key: "experimentInlineRowsMax",
        organizationId,
      });
      if (baseDataset.rows.length > maxRows) {
        throw new ExperimentEvaluationInputError({
          status: 422,
          reason:
            `The request carries ${baseDataset.rows.length} rows; this plan allows at most ` +
            `${maxRows} rows sent with one run. Send fewer rows, or save them as a dataset and ` +
            "run against it.",
        });
      }
    }

    // Caller parameters become constant columns across every row, and a single
    // synthetic row when there is no dataset.
    const { rows: datasetRows, columns: datasetColumns } = applyParametersToRows({
      rows: baseDataset.rows,
      columns: baseDataset.columns,
      parameters: inputs?.parameters,
    });

    const targetLoading = ExperimentTargetLoadingService.create();
    const loadedPrompts = await targetLoading.loadPrompts({
      projectId,
      targets,
      services,
    });

    const loadedAgents = await targetLoading.loadAgents({
      projectId,
      targets,
      services,
    });

    const loadedWorkflows = await targetLoading.loadWorkflows({
      projectId,
      targets,
      services,
      loadedAgents,
    });

    const loadedEvaluators = await targetLoading.loadEvaluators({
      projectId,
      targets,
      evaluators,
      services,
    });

    return {
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    };
  }

  /**
   * The rows a run starts from: inline data, a named saved dataset, or the attached dataset
   * reference, in that precedence.
   */
  private async resolveBaseDataset({
    projectId,
    organizationId,
    dataset,
    services,
    inputs,
  }: {
    projectId: string;
    organizationId: string;
    dataset: DatasetInput;
    services: ExecutionDataServices;
    inputs?: ExecutionDataInputs;
  }): Promise<BaseDataset> {
    if (inputs?.data) {
      return { ...rowsFromInlineData(inputs.data), source: "inline" };
    }

    if (!inputs?.datasetId) {
      return this.loadDataset({ dataset, projectId, organizationId, services });
    }

    const saved = await this.readSavedDataset({
      slugOrId: inputs.datasetId,
      projectId,
      organizationId,
      services,
    });
    const columns = saved.columnTypes.map((c) => ({
      id: c.name,
      name: c.name,
      type: c.type,
    }));

    return {
      rows: parseJsonColumns(saved.rows, jsonColumnNames(columns)),
      columns,
      source: "saved",
    };
  }
}

/** The rows a run starts from, and whether the request or a saved dataset held them. */
type BaseDataset = LoadedDataset & { source: "inline" | "saved" };

/** The names of the columns whose cells hold JSON. */
function jsonColumnNames(columns: { name: string; type: string }[]): Set<string> {
  return new Set(
    columns.filter((c) => JSON_COLUMN_TYPES.some((type) => type === c.type)).map((c) => c.name),
  );
}
