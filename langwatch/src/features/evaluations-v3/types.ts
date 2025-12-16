/**
 * Evaluations V3 Types
 *
 * This file contains all the type definitions for the new spreadsheet-based
 * evaluation experience. The structure is designed to be easily mapped to/from
 * the workflow DSL.
 */

import type { LLMConfig, NodeDataset, Field } from "../../optimization_studio/types/dsl";
import type { EvaluatorTypes } from "../../server/evaluations/evaluators.generated";
import type { DatasetColumns, DatasetColumnType } from "../../server/datasets/types";

// ============================================================================
// Dataset Types
// ============================================================================

export type DatasetColumn = {
  id: string;
  name: string;
  type: DatasetColumnType;
};

export type DatasetRow = {
  id: string;
  values: Record<string, string | number | boolean | null>;
};

export type InlineDataset = {
  type: "inline";
  name: string;
  columns: DatasetColumn[];
  rows: DatasetRow[];
};

export type SavedDataset = {
  type: "saved";
  id: string;
  name: string;
  columns: DatasetColumn[];
};

export type EvaluationDataset = InlineDataset | SavedDataset;

// ============================================================================
// Agent (Executor) Types
// ============================================================================

export type AgentType = "llm" | "code";

export type LLMAgent = {
  id: string;
  type: "llm";
  name: string;
  model: string;
  llmConfig: LLMConfig;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  inputs: Field[];
  outputs: Field[];
  // Prompt management
  promptConfigId?: string;
  promptVersionId?: string;
};

export type CodeAgent = {
  id: string;
  type: "code";
  name: string;
  code: string;
  inputs: Field[];
  outputs: Field[];
};

export type Agent = LLMAgent | CodeAgent;

// ============================================================================
// Evaluator Types
// ============================================================================

export type EvaluatorCategory =
  | "expected_answer"
  | "llm_judge"
  | "quality"
  | "rag"
  | "safety"
  | "custom_evaluators";

export type Evaluator = {
  id: string;
  type: EvaluatorTypes | `custom/${string}`;
  name: string;
  category: EvaluatorCategory;
  settings: Record<string, unknown>;
  inputs: Field[];
};

// ============================================================================
// Mapping Types - Connects dataset columns, agent outputs, to evaluator inputs
// ============================================================================

export type MappingSource =
  | { type: "dataset"; columnId: string }
  | { type: "agent"; agentId: string; outputId: string };

export type AgentMapping = {
  agentId: string;
  inputMappings: Record<string, MappingSource | null>; // inputId -> source
};

export type EvaluatorMapping = {
  evaluatorId: string;
  // For each agent, define which inputs connect to which outputs
  agentMappings: Record<string, Record<string, MappingSource | null>>; // agentId -> { inputId -> source }
};

// ============================================================================
// Execution & Results Types
// ============================================================================

export type ExecutionStatus = "idle" | "running" | "completed" | "error" | "stopped";

export type AgentResult = {
  rowIndex: number;
  agentId: string;
  outputs: Record<string, unknown>;
  cost?: number;
  duration?: number;
  error?: string;
  traceId?: string;
};

export type EvaluatorResult = {
  rowIndex: number;
  evaluatorId: string;
  agentId: string; // Which agent's output was evaluated
  score?: number;
  passed?: boolean;
  label?: string;
  details?: string;
  cost?: number;
  duration?: number;
  error?: string;
  status: "processed" | "skipped" | "error";
};

export type EvaluationRun = {
  id: string;
  status: ExecutionStatus;
  versionId?: string;
  progress: number;
  total: number;
  agentResults: AgentResult[];
  evaluatorResults: EvaluatorResult[];
  timestamps: {
    startedAt?: number;
    finishedAt?: number;
    stoppedAt?: number;
  };
  error?: string;
};

// ============================================================================
// UI State Types
// ============================================================================

export type CellPosition = {
  section: "dataset" | "agent" | "evaluator";
  columnId: string;
  rowIndex: number;
};

export type ExpandedCell = CellPosition | null;

export type ActiveModal =
  | null
  | { type: "add-agent" }
  | { type: "edit-agent"; agentId: string }
  | { type: "add-evaluator" }
  | { type: "edit-evaluator"; evaluatorId: string }
  | { type: "agent-mapping"; agentId: string }
  | { type: "evaluator-mapping"; evaluatorId: string }
  | { type: "dataset-columns" }
  | { type: "save-dataset" }
  | { type: "choose-dataset" };

// ============================================================================
// Main Evaluation V3 State
// ============================================================================

export type EvaluationV3State = {
  // Metadata
  id?: string;
  experimentId?: string;
  experimentSlug?: string;
  name: string;
  workflowId?: string;

  // Core data
  dataset: EvaluationDataset;
  agents: Agent[];
  evaluators: Evaluator[];

  // Mappings
  agentMappings: AgentMapping[];
  evaluatorMappings: EvaluatorMapping[];

  // Current execution
  currentRun?: EvaluationRun;
  runHistory: Array<{
    runId: string;
    versionId: string;
    createdAt: number;
  }>;

  // UI state
  expandedCell: ExpandedCell;
  activeModal: ActiveModal;
  selectedRunId?: string;

  // Autosave
  isAutosaving: boolean;
  hasUnsavedChanges: boolean;
};

// ============================================================================
// Default/Initial Values
// ============================================================================

export const DEFAULT_COLUMNS: DatasetColumn[] = [
  { id: "input", name: "input", type: "string" },
  { id: "expected_output", name: "expected_output", type: "string" },
];

export const createEmptyRow = (columns: DatasetColumn[]): DatasetRow => ({
  id: `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  values: Object.fromEntries(columns.map((col) => [col.id, ""])),
});

export const INITIAL_DATASET: InlineDataset = {
  type: "inline",
  name: "Draft Dataset",
  columns: DEFAULT_COLUMNS,
  rows: [
    createEmptyRow(DEFAULT_COLUMNS),
    createEmptyRow(DEFAULT_COLUMNS),
    createEmptyRow(DEFAULT_COLUMNS),
  ],
};

export const INITIAL_STATE: EvaluationV3State = {
  name: "New Evaluation",
  dataset: INITIAL_DATASET,
  agents: [],
  evaluators: [],
  agentMappings: [],
  evaluatorMappings: [],
  runHistory: [],
  expandedCell: null,
  activeModal: null,
  isAutosaving: false,
  hasUnsavedChanges: false,
};

