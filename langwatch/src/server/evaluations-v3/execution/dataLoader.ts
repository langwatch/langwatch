/**
 * Shared data loading utilities for Evaluations V3 execution.
 *
 * Handles loading and normalizing datasets, prompts, agents, and evaluators
 * for both the execute route (UI) and the run route (CI/CD API).
 */

import type { Evaluator } from "@prisma/client";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { AgentService } from "~/server/agents/agent.service";
import { getFullDataset } from "~/server/api/routers/datasetRecord";
import { prisma } from "~/server/db";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import {
  PromptService,
  type VersionedPrompt,
} from "~/server/prompt-config/prompt.service";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:evaluations-v3:dataLoader");

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
      columns.filter((c) => JSON_COLUMN_TYPES.includes(c.type as any)).map((c) => c.name),
    );
    rows = parseJsonColumns(rows, jsonColumns);
  } else if (dataset.type === "saved" && dataset.datasetId) {
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
      columns.filter((c) => JSON_COLUMN_TYPES.includes(c.type as any)).map((c) => c.name),
    );
    rows = parseJsonColumns(rows, jsonColumns);
  } else {
    return { error: "Invalid dataset configuration", status: 400 };
  }

  return { rows, columns };
};

/**
 * Result of loading all execution data.
 */
export type LoadedExecutionData = {
  datasetRows: Array<Record<string, unknown>>;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators: Map<string, Evaluator>;
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
export const loadExecutionData = async (
  projectId: string,
  dataset: DatasetInput,
  targets: TargetForLoading[],
  evaluators: EvaluatorForLoading[],
): Promise<LoadedExecutionData | { error: string; status: number }> => {
  // Load dataset
  const datasetResult = await loadDataset(dataset, projectId);
  if ("error" in datasetResult) {
    return datasetResult;
  }

  const { rows: datasetRows, columns: datasetColumns } = datasetResult;

  // Load prompts for prompt targets
  const loadedPrompts = new Map<string, VersionedPrompt>();
  const promptService = new PromptService(prisma);

  for (const target of targets) {
    if (target.type === "prompt" && target.promptId) {
      try {
        const prompt = await promptService.getPromptByIdOrHandle({
          idOrHandle: target.promptId,
          projectId,
          version: target.promptVersionNumber ?? undefined,
        });
        if (prompt) {
          loadedPrompts.set(target.promptId, prompt);
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
  const loadedAgents = new Map<string, TypedAgent>();
  const agentService = AgentService.create(prisma);

  for (const target of targets) {
    if (target.type === "agent" && target.dbAgentId) {
      const agent = await agentService.getById({
        id: target.dbAgentId,
        projectId,
      });
      if (agent) {
        loadedAgents.set(target.dbAgentId, agent);
      }
    }
  }

  // Load evaluators from DB (for both evaluator configs AND evaluator targets)
  const loadedEvaluators = new Map<string, Evaluator>();
  const evaluatorService = EvaluatorService.create(prisma);

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
  for (const evaluatorId of evaluatorIdsToLoad) {
    const dbEvaluator = await evaluatorService.getById({
      id: evaluatorId,
      projectId,
    });
    if (dbEvaluator) {
      loadedEvaluators.set(evaluatorId, dbEvaluator);
    }
  }

  return {
    datasetRows,
    datasetColumns,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
  };
};
