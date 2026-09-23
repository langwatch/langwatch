/**
 * Shared data loading utilities for Evaluations V3 execution.
 */

import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi, VersionedPrompt } from "@langwatch/prompt-contract";
import {
  transposeColumnsFirstToRowsFirstWithId,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";

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

// Column types that store JSON and need parsing
const JSON_COLUMN_TYPES = ["chat_messages", "json", "list", "spans", "rag_contexts"] as const;

/**
 * Parses JSON string values in specified columns.
 */
const parseJsonColumns = (
  rows: Record<string, unknown>[],
  jsonColumnKeys: Set<string>,
): Record<string, unknown>[] => {
  if (jsonColumnKeys.size === 0) {
    return rows;
  }

  return rows.map((row) => {
    const parsedRow = { ...row };
    for (const key of jsonColumnKeys) {
      const value = parsedRow[key];
      if (typeof value === "string" && value.trim()) {
        try {
          parsedRow[key] = JSON.parse(value);
        } catch {
          // Keep original string if not valid JSON
        }
      }
    }

    return parsedRow;
  });
};

/**
 * Normalizes inline dataset records from column IDs to column names.
 */
const normalizeColumnIdsToNames = (
  rows: Record<string, unknown>[],
  columns: { id: string; name: string }[],
): Record<string, unknown>[] => {
  const idToName = Object.fromEntries(columns.map((c) => [c.id, c.name]));

  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      // Use name if we have a mapping, otherwise keep the key as-is
      normalized[idToName[key] ?? key] = value;
    }

    return normalized;
  });
};

/**
 * Result of loading a dataset.
 */
export type LoadedDataset = {
  rows: Record<string, unknown>[];
  columns: { id: string; name: string; type: string }[];
};

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
 * Normalizes inline row-first data (from the run API or an SDK) into the
 * loaded dataset shape. Columns are derived from the union of keys across
 * rows.
 */
const rowsFromInlineData = (data: Record<string, unknown>[]): LoadedDataset => {
  const columnNames: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columnNames.push(key);
      }
    }
  }

  return {
    rows: data,
    columns: columnNames.map((name) => ({ id: name, name, type: "string" })),
  };
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
   * The tier-effective row bound inline data must fit under, and the directory
   * that answers which organization a project belongs to. The load refuses
   * rows above the caller's tier so the bound holds at every entry.
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
   * Loads and normalizes a dataset (inline or saved).
   */
  static async loadDataset(
    dataset: DatasetInput,
    projectId: string,
    datasets: DatasetApi,
  ): Promise<LoadedDataset | { error: string; status: number }> {
    let rows: Record<string, unknown>[];
    let columns: { id: string; name: string; type: string }[];

    if (dataset.type === "inline" && dataset.inline) {
      columns = dataset.inline.columns;

      // Transpose from columns-first to rows-first
      // Cast to string[] since the function handles any values internally
      rows = transposeColumnsFirstToRowsFirstWithId(
        dataset.inline.records as Record<string, string[]>,
      );

      // Normalize column IDs to names (inline uses IDs like "input_0")
      rows = normalizeColumnIdsToNames(rows, columns);

      // Parse JSON columns
      const jsonColumns = new Set(
        columns.filter((c) => JSON_COLUMN_TYPES.includes(c.type as any)).map((c) => c.name),
      );
      rows = parseJsonColumns(rows, jsonColumns);
    } else if (dataset.type === "saved" && dataset.datasetId) {
      // ADR-032 I-READY: a non-ready (uploading/processing/failed) s3_jsonl
      // dataset throws DatasetNotReadyError here — it must NOT be silently treated
      // as empty. The throw propagates as a clear run error; do not swallow it.
      const loadedDataset = await datasets.getDatasetWithRecords({
        slugOrId: dataset.datasetId,
        projectId,
        entrySelection: "all",
        limitMb: null,
      });

      columns = dataset.columns;
      rows = loadedDataset.records.map((r) => r.entry as Record<string, unknown>);

      // Parse JSON columns (saved datasets already use names as keys)
      const jsonColumns = new Set(
        columns.filter((c) => JSON_COLUMN_TYPES.includes(c.type as any)).map((c) => c.name),
      );
      rows = parseJsonColumns(rows, jsonColumns);
    } else {
      return { error: "Invalid dataset configuration", status: 400 };
    }

    return { rows, columns };
  }

  /**
   * Applies caller-provided parameters as constant columns across every row.
   */
  static applyParametersToRows({
    rows,
    columns,
    parameters,
  }: {
    rows: Record<string, unknown>[];
    columns: { id: string; name: string; type: string }[];
    parameters?: Record<string, string | number | boolean>;
  }): {
    rows: Record<string, unknown>[];
    columns: { id: string; name: string; type: string }[];
  } {
    if (!parameters || Object.keys(parameters).length === 0) {
      return { rows, columns };
    }

    const existingNames = new Set(columns.map((c) => c.name));
    const parameterColumnType = (value: string | number | boolean): string =>
      typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
    // A parameter overriding an existing column rewrites every row's value below,
    // so the column's declared type must follow the parameter or the rows and the
    // column metadata would disagree (e.g. a number written into a "string" column).
    const columnsWithParameters = [
      ...columns.map((column) =>
        Object.hasOwn(parameters, column.name)
          ? { ...column, type: parameterColumnType(parameters[column.name]!) }
          : column,
      ),
      ...Object.entries(parameters)
        .filter(([key]) => !existingNames.has(key))
        .map(([key, value]) => ({
          id: key,
          name: key,
          type: parameterColumnType(value),
        })),
    ];

    // With no rows, the parameters themselves form a single synthetic row.
    const baseRows = rows.length === 0 ? [{}] : rows;
    const rowsWithParameters = baseRows.map((row) => ({ ...row, ...parameters }));

    return { rows: rowsWithParameters, columns: columnsWithParameters };
  }

  /**
   * Cache key for a loaded workflow. Two targets that pin the same workflow to
   * different versions must not share a loaded DSL, so the key includes the
   * requested version (or "published" when following the latest committed one).
   */
  static workflowLoadKey(target: { workflowId?: string; workflowVersionId?: string }): string {
    return `${target.workflowId ?? ""}::${target.workflowVersionId ?? "published"}`;
  }

  /**
   * Cache key for a loaded prompt. Two targets that pin the same prompt to
   * different versions must not share a loaded prompt, so the key includes the
   * requested version (or "latest" when the target follows the newest one).
   */
  static promptLoadKey(target: { promptId?: string; promptVersionNumber?: number }): string {
    return `${target.promptId ?? ""}@${target.promptVersionNumber ?? "latest"}`;
  }

  /**
   * Everything a run needs before its first row: the dataset it evaluates and every prompt, agent,
   * workflow and evaluator its targets name. A missing target is reported as the sentinel error
   * shape rather than run around, so a deleted target stops the run instead of emptying a column.
   */
  static async loadExecutionData({
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
  }): Promise<LoadedExecutionData | { error: string; status: number }> {
    const baseDataset = await ExperimentExecutionDataService.resolveBaseDataset({
      projectId,
      dataset,
      services,
      inputs,
    });
    if ("error" in baseDataset) {
      return baseDataset;
    }

    // The row bound the caller's plan answers, enforced at the load so it
    // holds for inline data a transport let through and for saved datasets
    // alike. Refused, not truncated: a run over a silently shortened dataset
    // reports success over the wrong rows.
    const rowBound = await ExperimentExecutionDataService.resolveRowBound(projectId, services);
    if (baseDataset.rows.length > rowBound) {
      return {
        error: `The dataset has ${baseDataset.rows.length} rows; this plan allows at most ${rowBound} per run. Reduce the rows or run against a saved dataset.`,
        status: 422,
      };
    }

    // Caller parameters become constant columns across every row, and a single
    // synthetic row when there is no dataset.
    const { rows: datasetRows, columns: datasetColumns } =
      ExperimentExecutionDataService.applyParametersToRows({
        rows: baseDataset.rows,
        columns: baseDataset.columns,
        parameters: inputs?.parameters,
      });

    const loadedPrompts = await ExperimentTargetLoadingService.loadPrompts({
      projectId,
      targets,
      services,
    });
    if ("error" in loadedPrompts) {
      return loadedPrompts;
    }

    const loadedAgents = await ExperimentTargetLoadingService.loadAgents({
      projectId,
      targets,
      services,
    });
    if ("error" in loadedAgents) {
      return loadedAgents;
    }

    const loadedWorkflows = await ExperimentTargetLoadingService.loadWorkflows({
      projectId,
      targets,
      services,
      loadedAgents,
    });
    if ("error" in loadedWorkflows) {
      return loadedWorkflows;
    }

    const loadedEvaluators = await ExperimentTargetLoadingService.loadEvaluators({
      projectId,
      targets,
      evaluators,
      services,
    });
    if ("error" in loadedEvaluators) {
      return loadedEvaluators;
    }

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
   * The row bound the project's plan answers: the registry's
   * `experimentInlineRowsMax` on the organization's tier, boot overrides
   * included — the same resolution the entitlement application makes.
   */
  private static async resolveRowBound(
    projectId: string,
    services: ExecutionDataServices,
  ): Promise<number> {
    const organizationId = await services.projects.getOrganizationId(projectId);

    return services.entitlements.requestBound({
      key: "experimentInlineRowsMax",
      organizationId,
    });
  }

  /**
   * The rows a run starts from: inline data, a named saved dataset, or the attached dataset
   * reference, in that precedence.
   */
  private static async resolveBaseDataset({
    projectId,
    dataset,
    services,
    inputs,
  }: {
    projectId: string;
    dataset: DatasetInput;
    services: ExecutionDataServices;
    inputs?: ExecutionDataInputs;
  }): Promise<LoadedDataset | { error: string; status: number }> {
    if (inputs?.data) {
      return rowsFromInlineData(inputs.data);
    }

    if (!inputs?.datasetId) {
      return ExperimentExecutionDataService.loadDataset(dataset, projectId, services.datasets);
    }

    const loadedDataset = await services.datasets.getDatasetWithRecords({
      slugOrId: inputs.datasetId,
      projectId,
      entrySelection: "all",
      limitMb: null,
    });
    const columns = (
      (loadedDataset.dataset.columnTypes as unknown as {
        name: string;
        type: string;
      }[]) ?? []
    ).map((c) => ({ id: c.name, name: c.name, type: c.type }));
    const jsonColumnKeys = new Set(
      columns
        .filter((c) => (JSON_COLUMN_TYPES as readonly string[]).includes(c.type))
        .map((c) => c.name),
    );

    return {
      rows: parseJsonColumns(
        loadedDataset.records.map((r) => r.entry as Record<string, unknown>),
        jsonColumnKeys,
      ),
      columns,
    };
  }
}
