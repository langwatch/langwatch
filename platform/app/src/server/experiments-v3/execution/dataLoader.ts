/**
 * Shared data loading utilities for Evaluations V3 execution.
 *
 * Handles loading and normalizing datasets, prompts, agents, and evaluators
 * for both the execute route (UI) and the run route (CI/CD API).
 */

import { createLogger } from "@langwatch/observability";
import type { Evaluator } from "@prisma/client";
import type { Workflow } from "~/optimization_studio/types/dsl";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { AgentService } from "~/server/agents/agent.service";
import { getFullDataset } from "~/server/api/routers/datasetRecord.utils";
import { prisma } from "~/server/db";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import {
  PromptService,
  type VersionedPrompt,
} from "~/server/prompt-config/prompt.service";

const logger = createLogger("langwatch:experiments-v3:dataLoader");

// Column types that store JSON and need parsing
const JSON_COLUMN_TYPES = [
  "chat_messages",
  "json",
  "list",
  "spans",
  "rag_contexts",
] as const;

/**
 * Parses JSON string values in specified columns.
 */
const parseJsonColumns = (
  rows: Array<Record<string, unknown>>,
  jsonColumnKeys: Set<string>,
): Array<Record<string, unknown>> => {
  if (jsonColumnKeys.size === 0) return rows;

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
 *
 * Inline datasets use synthetic column IDs (e.g., "input_0", "messages_2")
 * for UI purposes (React keys, duplicate handling, renaming). This function
 * normalizes them to use column names, matching saved dataset format.
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
 * Loads and normalizes a dataset (inline or saved).
 *
 * - Inline datasets: Transposes column-first to row-first, normalizes IDs to names
 * - Saved datasets: Loads from DB
 * - Both: Parses JSON columns (chat_messages, json, list, etc.)
 *
 * After this function, all dataset rows use column NAMES as keys.
 */
export const loadDataset = async (
  dataset: DatasetInput,
  projectId: string,
): Promise<LoadedDataset | { error: string; status: number }> => {
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
      columns
        .filter((c) => JSON_COLUMN_TYPES.includes(c.type as any))
        .map((c) => c.name),
    );
    rows = parseJsonColumns(rows, jsonColumns);
  } else if (dataset.type === "saved" && dataset.datasetId) {
    // ADR-032 I-READY: a non-ready (uploading/processing/failed) s3_jsonl
    // dataset throws DatasetNotReadyError here — it must NOT be silently treated
    // as empty. The throw propagates as a clear run error; do not swallow it.
    const fullDataset = await getFullDataset({
      datasetId: dataset.datasetId,
      projectId,
      entrySelection: "all",
    });

    if (!fullDataset) {
      return { error: "Dataset not found", status: 404 };
    }

    columns = dataset.columns;
    rows = fullDataset.datasetRecords.map(
      (r) => r.entry as Record<string, unknown>,
    );

    // Parse JSON columns (saved datasets already use names as keys)
    const jsonColumns = new Set(
      columns
        .filter((c) => JSON_COLUMN_TYPES.includes(c.type as any))
        .map((c) => c.name),
    );
    rows = parseJsonColumns(rows, jsonColumns);
  } else {
    return { error: "Invalid dataset configuration", status: 400 };
  }

  return { rows, columns };
};

/**
 * Applies caller-provided parameters as constant columns across every row.
 *
 * Each parameter overrides (or adds) that column on every row, and any
 * parameter that is not already a column is appended to the column list. With
 * no rows, the parameters form a single synthetic row, so an
 * evaluate-with-flags call needs no placeholder dataset. Mirrors the row-level
 * effect of the workflow entry-parameter injection.
 */
export const applyParametersToRows = ({
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
} => {
  if (!parameters || Object.keys(parameters).length === 0) {
    return { rows, columns };
  }

  const existingNames = new Set(columns.map((c) => c.name));
  const parameterColumnType = (value: string | number | boolean): string =>
    typeof value === "number"
      ? "number"
      : typeof value === "boolean"
        ? "boolean"
        : "string";
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
};

/**
 * Normalizes inline row-first data (from the run API or an SDK) into the loaded
 * dataset shape. Columns are derived from the union of keys across rows.
 *
 * Unlike the saved/attached-dataset paths, inline values are NOT run through
 * parseJsonColumns: row-first data arrives as native JSON (a caller posting a
 * chat-messages or rag-contexts column sends an actual array/object, not a
 * stringified one) and carries no declared column types to mark which strings
 * to parse. So every column is typed "string" and values pass through as-is;
 * structured fields are already structured. A caller that hand-sends
 * stringified JSON is responsible for sending it parsed instead.
 */
const rowsFromInlineData = (
  data: Array<Record<string, unknown>>,
): LoadedDataset => {
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
 * Result of loading all execution data.
 */
/**
 * A studio workflow loaded for a workflow target: the committed DSL that is run
 * as a whole, once per dataset row.
 */
export type LoadedWorkflow = {
  id: string;
  name: string;
  versionId: string;
  dsl: Workflow;
};

/**
 * Cache key for a loaded workflow. Two targets that pin the same workflow to
 * different versions must not share a loaded DSL, so the key includes the
 * requested version (or "published" when following the latest committed one).
 */
export const workflowLoadKey = (target: {
  workflowId?: string;
  workflowVersionId?: string;
}): string =>
  `${target.workflowId ?? ""}::${target.workflowVersionId ?? "published"}`;

export type LoadedExecutionData = {
  datasetRows: Array<Record<string, unknown>>;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
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
 * Loads all execution data: dataset, prompts, agents, evaluators.
 */
/**
 * Optional run-time inputs that override or supply the dataset to evaluate.
 * Sent by the run API, the workflow evaluate endpoint, and the SDKs.
 */
export type ExecutionDataInputs = {
  data?: Array<Record<string, unknown>>;
  datasetId?: string;
  parameters?: Record<string, string | number | boolean>;
};

type LoadError = { error: string; status: number };

const isLoadError = <T>(result: T | LoadError): result is LoadError =>
  !!result && typeof result === "object" && "error" in result;

/**
 * Resolves the base rows + columns: inline data, a saved dataset id, or the
 * attached dataset reference, in that precedence.
 */
const resolveBaseDataset = async ({
  projectId,
  dataset,
  inputs,
}: {
  projectId: string;
  dataset: DatasetInput;
  inputs?: ExecutionDataInputs;
}): Promise<LoadedDataset | LoadError> => {
  if (inputs?.data) {
    return rowsFromInlineData(inputs.data);
  }

  if (inputs?.datasetId) {
    const fullDataset = await getFullDataset({
      datasetId: inputs.datasetId,
      projectId,
      entrySelection: "all",
    });
    if (!fullDataset) {
      return { error: `Dataset "${inputs.datasetId}" not found`, status: 404 };
    }
    const columns = (
      (fullDataset.columnTypes as unknown as Array<{
        name: string;
        type: string;
      }>) ?? []
    ).map((c) => ({ id: c.name, name: c.name, type: c.type }));
    const jsonColumnKeys = new Set(
      columns
        .filter((c) =>
          (JSON_COLUMN_TYPES as readonly string[]).includes(c.type),
        )
        .map((c) => c.name),
    );
    return {
      rows: parseJsonColumns(
        fullDataset.datasetRecords.map(
          (r) => r.entry as Record<string, unknown>,
        ),
        jsonColumnKeys,
      ),
      columns,
    };
  }

  return loadDataset(dataset, projectId);
};

const loadPromptForTarget = async ({
  target,
  projectId,
  promptService,
}: {
  target: TargetForLoading & { promptId: string };
  projectId: string;
  promptService: PromptService;
}): Promise<VersionedPrompt | LoadError> => {
  const versionInfo = target.promptVersionNumber
    ? ` version ${target.promptVersionNumber}`
    : "";
  try {
    const prompt = await promptService.getPromptByIdOrHandle({
      idOrHandle: target.promptId,
      projectId,
      version: target.promptVersionNumber ?? undefined,
    });
    if (!prompt) {
      return {
        error: `Prompt "${target.promptId}"${versionInfo} not found`,
        status: 404,
      };
    }
    return prompt;
  } catch (promptError) {
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
};

/** Loads prompts for prompt targets. */
const loadPromptsForTargets = async ({
  targets,
  projectId,
}: {
  targets: TargetForLoading[];
  projectId: string;
}): Promise<Map<string, VersionedPrompt> | LoadError> => {
  const loadedPrompts = new Map<string, VersionedPrompt>();
  const promptService = new PromptService(prisma);

  for (const target of targets) {
    if (target.type !== "prompt" || !target.promptId) continue;

    const result = await loadPromptForTarget({
      target: target as TargetForLoading & { promptId: string },
      projectId,
      promptService,
    });
    if (isLoadError(result)) return result;
    loadedPrompts.set(target.promptId, result);
  }

  return loadedPrompts;
};

/** Loads agents for agent targets. */
const loadAgentsForTargets = async ({
  targets,
  projectId,
}: {
  targets: TargetForLoading[];
  projectId: string;
}): Promise<Map<string, TypedAgent>> => {
  const loadedAgents = new Map<string, TypedAgent>();
  const agentService = AgentService.create(prisma);

  for (const target of targets) {
    if (target.type !== "agent" || !target.dbAgentId) continue;
    const agent = await agentService.getById({
      id: target.dbAgentId,
      projectId,
    });
    if (agent) {
      loadedAgents.set(target.dbAgentId, agent);
    }
  }

  return loadedAgents;
};

const loadPublishedWorkflow = async ({
  workflowId,
  workflowVersionId,
  projectId,
}: {
  workflowId: string;
  workflowVersionId?: string;
  projectId: string;
}): Promise<LoadedWorkflow | LoadError> => {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId, projectId },
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

  const version = await prisma.workflowVersion.findUnique({
    where: { id: versionId, projectId, workflowId },
  });
  if (!version) {
    return {
      error: `Workflow version "${versionId}" not found`,
      status: 404,
    };
  }

  return {
    id: workflow.id,
    name: workflow.name,
    versionId,
    dsl: version.dsl as unknown as Workflow,
  };
};

/** Loads the studio workflow DSL for every direct workflow target. */
const loadDirectWorkflowTargets = async ({
  targets,
  projectId,
  loadedWorkflows,
}: {
  targets: TargetForLoading[];
  projectId: string;
  loadedWorkflows: Map<string, LoadedWorkflow>;
}): Promise<LoadError | undefined> => {
  for (const target of targets) {
    if (target.type !== "workflow" || !target.workflowId) continue;
    if (loadedWorkflows.has(workflowLoadKey(target))) continue;

    const result = await loadPublishedWorkflow({
      workflowId: target.workflowId,
      workflowVersionId: target.workflowVersionId,
      projectId,
    });
    if (isLoadError(result)) return result;
    loadedWorkflows.set(workflowLoadKey(target), result);
  }
  return undefined;
};

/**
 * An agent target can itself wrap a Studio workflow (agent.type ===
 * "workflow", created via Agent -> New Agent -> Workflow). That agent has no
 * code of its own — just a pointer to the linked workflow. Resolves the
 * workflow id the target's agent links to, or undefined when the target
 * isn't a workflow-backed agent.
 */
const linkedWorkflowIdForTarget = ({
  target,
  loadedAgents,
}: {
  target: TargetForLoading;
  loadedAgents: Map<string, TypedAgent>;
}): string | undefined => {
  if (target.type !== "agent" || !target.dbAgentId) return undefined;
  const agent = loadedAgents.get(target.dbAgentId);
  if (agent?.type !== "workflow") return undefined;
  return (
    agent.workflowId ?? (agent.config as { workflow_id?: string }).workflow_id
  );
};

/**
 * That agent has no code of its own — just a pointer to the linked
 * workflow — so it must run the whole workflow the same way a direct
 * workflow target does, not the agent's (nonexistent) code. Resolves and
 * caches that linked workflow so the orchestrator can dispatch it to
 * executeWorkflowCell.
 */
const loadLinkedAgentWorkflowTargets = async ({
  targets,
  projectId,
  loadedAgents,
  loadedWorkflows,
}: {
  targets: TargetForLoading[];
  projectId: string;
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows: Map<string, LoadedWorkflow>;
}): Promise<LoadError | undefined> => {
  for (const target of targets) {
    const linkedWorkflowId = linkedWorkflowIdForTarget({
      target,
      loadedAgents,
    });
    if (!linkedWorkflowId) continue;

    const key = workflowLoadKey({ workflowId: linkedWorkflowId });
    if (loadedWorkflows.has(key)) continue;

    const result = await loadPublishedWorkflow({
      workflowId: linkedWorkflowId,
      projectId,
    });
    if (isLoadError(result)) return result;
    loadedWorkflows.set(key, result);
  }
  return undefined;
};

/** Loads studio workflows for workflow targets and workflow-backed agent targets. */
const loadWorkflowsForTargets = async ({
  targets,
  projectId,
  loadedAgents,
}: {
  targets: TargetForLoading[];
  projectId: string;
  loadedAgents: Map<string, TypedAgent>;
}): Promise<Map<string, LoadedWorkflow> | LoadError> => {
  const loadedWorkflows = new Map<string, LoadedWorkflow>();

  const directError = await loadDirectWorkflowTargets({
    targets,
    projectId,
    loadedWorkflows,
  });
  if (directError) return directError;

  const linkedError = await loadLinkedAgentWorkflowTargets({
    targets,
    projectId,
    loadedAgents,
    loadedWorkflows,
  });
  if (linkedError) return linkedError;

  return loadedWorkflows;
};

/** Loads evaluators from DB (for both evaluator configs AND evaluator targets). */
const loadEvaluatorsForTargets = async ({
  targets,
  evaluators,
  projectId,
}: {
  targets: TargetForLoading[];
  evaluators: EvaluatorForLoading[];
  projectId: string;
}): Promise<Map<string, Evaluator>> => {
  const loadedEvaluators = new Map<string, Evaluator>();
  const evaluatorService = EvaluatorService.create(prisma);

  const evaluatorIdsToLoad = new Set<string>();
  for (const evaluator of evaluators) {
    if (evaluator.dbEvaluatorId) {
      evaluatorIdsToLoad.add(evaluator.dbEvaluatorId);
    }
  }
  for (const target of targets) {
    if (target.type === "evaluator" && target.targetEvaluatorId) {
      evaluatorIdsToLoad.add(target.targetEvaluatorId);
    }
  }

  for (const evaluatorId of evaluatorIdsToLoad) {
    const dbEvaluator = await evaluatorService.getById({
      id: evaluatorId,
      projectId,
    });
    if (dbEvaluator) {
      loadedEvaluators.set(evaluatorId, dbEvaluator);
    }
  }

  return loadedEvaluators;
};

export const loadExecutionData = async ({
  projectId,
  dataset,
  targets,
  evaluators,
  inputs,
}: {
  projectId: string;
  dataset: DatasetInput;
  targets: TargetForLoading[];
  evaluators: EvaluatorForLoading[];
  inputs?: ExecutionDataInputs;
}): Promise<LoadedExecutionData | { error: string; status: number }> => {
  const baseDataset = await resolveBaseDataset({ projectId, dataset, inputs });
  if (isLoadError(baseDataset)) return baseDataset;

  // Apply caller parameters as constant columns across every row (and a single
  // synthetic row when there is no dataset).
  const { rows: datasetRows, columns: datasetColumns } = applyParametersToRows({
    rows: baseDataset.rows,
    columns: baseDataset.columns,
    parameters: inputs?.parameters,
  });

  const loadedPrompts = await loadPromptsForTargets({ targets, projectId });
  if (isLoadError(loadedPrompts)) return loadedPrompts;

  const loadedAgents = await loadAgentsForTargets({ targets, projectId });

  const loadedWorkflows = await loadWorkflowsForTargets({
    targets,
    projectId,
    loadedAgents,
  });
  if (isLoadError(loadedWorkflows)) return loadedWorkflows;

  const loadedEvaluators = await loadEvaluatorsForTargets({
    targets,
    evaluators,
    projectId,
  });

  return {
    datasetRows,
    datasetColumns,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  };
};
