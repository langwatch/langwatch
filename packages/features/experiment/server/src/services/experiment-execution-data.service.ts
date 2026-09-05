/**
 * Shared data loading utilities for Evaluations V3 execution.
 */

import { createLogger } from "@langwatch/observability";
import { AgentNotFoundError, type Agent, type AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { Evaluator, EvaluatorService } from "@langwatch/evaluator-contract";
import {
  parseStudioWorkflow,
  transposeColumnsFirstToRowsFirstWithId,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import type { PromptService, VersionedPrompt } from "@langwatch/prompt-contract";
import type { ExperimentWorkflowDslPort } from "../ports/experiment-workflow-dsl.port";

const logger = createLogger("langwatch:experiment:execution-data");

// Column types that store JSON and need parsing
const JSON_COLUMN_TYPES = ["chat_messages", "json", "list", "spans", "rag_contexts"] as const;

/**
 * Parses JSON string values in specified columns.
 */
const parseJsonColumns = (
  rows: Array<Record<string, unknown>>,
  jsonColumnKeys: Set<string>,
): Array<Record<string, unknown>> => {
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
  rows: Array<Record<string, unknown>>,
  columns: Array<{ id: string; name: string }>,
): Array<Record<string, unknown>> => {
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
  rows: Array<Record<string, unknown>>;
  columns: Array<{ id: string; name: string; type: string }>;
};

/**
 * Flexible dataset input type that works with both runtime (DatasetReference)
 * and persisted state schemas.
 */
type DatasetInput = {
  type: "inline" | "saved";
  inline?: {
    columns: Array<{ id: string; name: string; type: string }>;
    records: Record<string, unknown[]>;
  };
  datasetId?: string;
  columns: Array<{ id: string; name: string; type: string }>;
};

/**
 * Normalizes inline row-first data (from the run API or an SDK) into the
 * loaded dataset shape. Columns are derived from the union of keys across
 * rows.
 */
const rowsFromInlineData = (data: Array<Record<string, unknown>>): LoadedDataset => {
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
  datasetRows: Array<Record<string, unknown>>;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
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
  data?: Array<Record<string, unknown>>;
  datasetId?: string;
  parameters?: Record<string, string | number | boolean>;
};

/**
 * Canonical feature services this load reads through.
 */
export type ExecutionDataServices = {
  datasets: DatasetService;
  prompts: PromptService;
  agents: AgentService;
  /** The committed studio DSL a workflow target runs, once per dataset row. */
  workflows: ExperimentWorkflowDslPort;
  evaluators?: EvaluatorService;
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
    datasets: DatasetService,
  ): Promise<LoadedDataset | { error: string; status: number }> {
    let rows: Array<Record<string, unknown>>;
    let columns: Array<{ id: string; name: string; type: string }>;

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
    rows: Array<Record<string, unknown>>;
    columns: Array<{ id: string; name: string; type: string }>;
    parameters?: Record<string, string | number | boolean>;
  }): {
    rows: Array<Record<string, unknown>>;
    columns: Array<{ id: string; name: string; type: string }>;
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
   * Loads all execution data: dataset, prompts, agents, evaluators.
   */
  static async loadExecutionData(
    projectId: string,
    dataset: DatasetInput,
    targets: TargetForLoading[],
    evaluators: EvaluatorForLoading[],
    services: ExecutionDataServices,
    inputs?: ExecutionDataInputs,
  ): Promise<LoadedExecutionData | { error: string; status: number }> {
    // Resolve the base rows + columns: inline data, a saved dataset id, or the
    // attached dataset reference, in that precedence.
    let baseDataset: LoadedDataset;
    if (inputs?.data) {
      baseDataset = rowsFromInlineData(inputs.data);
    } else if (inputs?.datasetId) {
      const loadedDataset = await services.datasets.getDatasetWithRecords({
        slugOrId: inputs.datasetId,
        projectId,
        entrySelection: "all",
        limitMb: null,
      });
      const columns = (
        (loadedDataset.dataset.columnTypes as unknown as Array<{
          name: string;
          type: string;
        }>) ?? []
      ).map((c) => ({ id: c.name, name: c.name, type: c.type }));
      const jsonColumnKeys = new Set(
        columns
          .filter((c) => (JSON_COLUMN_TYPES as readonly string[]).includes(c.type))
          .map((c) => c.name),
      );
      baseDataset = {
        rows: parseJsonColumns(
          loadedDataset.records.map((r) => r.entry as Record<string, unknown>),
          jsonColumnKeys,
        ),
        columns,
      };
    } else {
      const datasetResult = await ExperimentExecutionDataService.loadDataset(
        dataset,
        projectId,
        services.datasets,
      );
      if ("error" in datasetResult) {
        return datasetResult;
      }

      baseDataset = datasetResult;
    }

    // Apply caller parameters as constant columns across every row (and a single
    // synthetic row when there is no dataset).
    const { rows: datasetRows, columns: datasetColumns } =
      ExperimentExecutionDataService.applyParametersToRows({
        rows: baseDataset.rows,
        columns: baseDataset.columns,
        parameters: inputs?.parameters,
      });

    // Load prompts for prompt targets
    const loadedPrompts = new Map<string, VersionedPrompt>();
    const promptService = services.prompts;

    for (const target of targets) {
      if (target.type === "prompt" && target.promptId) {
        if (loadedPrompts.has(ExperimentExecutionDataService.promptLoadKey(target))) {
          continue;
        }

        try {
          const prompt = await promptService.tryGetPromptByIdOrHandle({
            idOrHandle: target.promptId,
            projectId,
            version: target.promptVersionNumber ?? undefined,
          });
          if (prompt) {
            loadedPrompts.set(ExperimentExecutionDataService.promptLoadKey(target), prompt);
          } else {
            const versionInfo = target.promptVersionNumber
              ? ` version ${target.promptVersionNumber}`
              : "";

            return {
              error: `Prompt "${target.promptId}"${versionInfo} not found`,
              status: 404,
            };
          }
        } catch (promptError) {
          const versionInfo = target.promptVersionNumber
            ? ` version ${target.promptVersionNumber}`
            : "";
          logger.error(
            {
              error: promptError,
              promptId: target.promptId,
              version: target.promptVersionNumber,
            },
            "Failed to load prompt for target",
          );

          return {
            error: `Failed to load prompt "${target.promptId}"${versionInfo}: ${(promptError as Error).message}`,
            status: 404,
          };
        }
      }
    }

    // Load agents for agent targets
    const loadedAgents = new Map<string, Agent>();
    const agentService = services.agents;

    for (const target of targets) {
      if (target.type === "agent" && target.dbAgentId) {
        // A missing agent used to leave the map short and the run continued against nothing,
        // reporting an empty column rather than the deletion that caused it. Same answer as a
        // missing prompt or workflow: say what is gone and stop. `getById` throws
        // `AgentNotFoundError` rather than returning a nullable — translate it to the same
        // sentinel shape every other missing-target path in this loader returns.
        let agent: Agent;
        try {
          agent = await agentService.getById({
            id: target.dbAgentId,
            projectId,
          });
        } catch (error) {
          if (error instanceof AgentNotFoundError) {
            return { error: `Agent "${target.dbAgentId}" not found`, status: 404 };
          }

          throw error;
        }

        loadedAgents.set(target.dbAgentId, agent);
      }
    }

    // Load studio workflows for workflow targets (the committed DSL run per row)
    const loadedWorkflows = new Map<string, LoadedWorkflow>();

    const loadPublishedWorkflow = async ({
      workflowId,
      workflowVersionId,
    }: {
      workflowId: string;
      workflowVersionId?: string;
    }): Promise<LoadedWorkflow | { error: string; status: number }> => {
      const workflow = await services.workflows.tryFindWorkflow({
        projectId,
        workflowId,
      });
      if (!workflow) {
        return { error: `Workflow "${workflowId}" not found`, status: 404 };
      }

      const versionId = workflowVersionId ?? workflow.publishedId;
      if (!versionId) {
        return {
          error: `Workflow "${workflowId}" has no committed version to evaluate`,
          status: 400,
        };
      }

      const dsl = await services.workflows.tryFindVersionDsl({
        projectId,
        workflowId,
        versionId,
      });
      if (!dsl) {
        return {
          error: `Workflow version "${versionId}" not found`,
          status: 404,
        };
      }

      return {
        id: workflow.id,
        name: workflow.name,
        versionId,
        dsl: parseStudioWorkflow(dsl),
      };
    };

    for (const target of targets) {
      if (target.type !== "workflow" || !target.workflowId) {
        continue;
      }

      if (loadedWorkflows.has(ExperimentExecutionDataService.workflowLoadKey(target))) {
        continue;
      }

      const result = await loadPublishedWorkflow({
        workflowId: target.workflowId,
        workflowVersionId: target.workflowVersionId,
      });
      if ("error" in result) {
        return result;
      }

      loadedWorkflows.set(ExperimentExecutionDataService.workflowLoadKey(target), result);
    }

    // An agent target can itself wrap a Studio workflow (agent.type === "workflow", created
    // via Agent -> New Agent -> Workflow). That agent has no code of its own — just a pointer
    // to the linked workflow — so it must run the whole workflow the same way a direct
    // workflow target does, not the agent's (nonexistent) code. Resolve and cache that linked
    // workflow here so the orchestrator can dispatch it to executeWorkflowCell.
    for (const target of targets) {
      if (target.type !== "agent" || !target.dbAgentId) {
        continue;
      }

      const agent = loadedAgents.get(target.dbAgentId);
      if (agent?.type !== "workflow") {
        continue;
      }

      const linkedWorkflowId =
        agent.workflowId ?? (agent.config as { workflow_id?: string }).workflow_id;
      if (!linkedWorkflowId) {
        continue;
      }

      const key = ExperimentExecutionDataService.workflowLoadKey({ workflowId: linkedWorkflowId });
      if (loadedWorkflows.has(key)) {
        continue;
      }

      const result = await loadPublishedWorkflow({
        workflowId: linkedWorkflowId,
      });
      if ("error" in result) {
        return result;
      }

      loadedWorkflows.set(key, result);
    }

    // Load evaluators from DB (for both evaluator configs AND evaluator targets)
    const loadedEvaluators = new Map<string, Evaluator>();
    // Collect all evaluator IDs to load
    const evaluatorIdsToLoad = new Set<string>();

    // Add evaluator IDs from evaluator configs
    for (const evaluator of evaluators) {
      if (evaluator.dbEvaluatorId) {
        evaluatorIdsToLoad.add(evaluator.dbEvaluatorId);
      }
    }

    // Add evaluator IDs from evaluator targets
    for (const target of targets) {
      if (target.type === "evaluator" && target.targetEvaluatorId) {
        evaluatorIdsToLoad.add(target.targetEvaluatorId);
      }
    }

    // Load all evaluators
    if (evaluatorIdsToLoad.size > 0 && !services.evaluators) {
      throw new Error(
        "ExecutionDataServices.evaluators is required when an execution references an evaluator",
      );
    }

    for (const evaluatorId of evaluatorIdsToLoad) {
      const dbEvaluator = await services.evaluators?.tryGetById({
        id: evaluatorId,
        projectId,
      });
      // Same answer as a missing prompt, agent, or workflow: say what is gone
      // and stop, rather than silently running with fewer evaluators than
      // configured.
      if (!dbEvaluator) {
        return { error: `Evaluator "${evaluatorId}" not found`, status: 404 };
      }

      loadedEvaluators.set(evaluatorId, dbEvaluator);
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
}
