import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { ChatMessage } from "~/server/tracer/types";
import type { Field, ExecutionStatus, LLMConfig } from "~/optimization_studio/types/dsl";

// ============================================================================
// Dataset Types
// ============================================================================

export type DatasetColumn = {
  id: string;
  name: string;
  type: DatasetColumnType;
};

export type InlineDataset = {
  id?: string; // undefined = inline, string = saved dataset reference
  name?: string;
  columns: DatasetColumn[];
  records: Record<string, string[]>; // columnId -> array of values per row
};

// ============================================================================
// Agent Types
// ============================================================================

export type AgentType = "llm" | "code";

export type AgentConfig = {
  id: string;
  type: AgentType;
  name: string;
  icon?: string;

  // For LLM (mirrors LlmPromptConfigComponent structure)
  llmConfig?: LLMConfig;
  messages?: ChatMessage[];
  instructions?: string;

  // For Code (mirrors Code node structure)
  code?: string;

  // Common
  inputs: Field[];
  outputs: Field[];
};

// ============================================================================
// Evaluator Types
// ============================================================================

export type EvaluatorConfig = {
  id: string;
  evaluatorType: EvaluatorTypes | `custom/${string}`;
  name: string;
  settings: Record<string, unknown>;
  inputs: Field[];
};

// ============================================================================
// Mapping Types
// ============================================================================

/**
 * Maps a target field to a source field.
 * Source can be "dataset" (for dataset columns) or an agent id (for agent outputs).
 */
export type FieldMapping = {
  source: "dataset" | string; // "dataset" or agent id
  sourceField: string;
};

/**
 * Mappings for an agent's inputs.
 * Maps input field identifier -> source mapping.
 */
export type AgentMappings = Record<string, Record<string, FieldMapping>>;
// agentId -> { inputFieldName -> mapping }

/**
 * Mappings for an evaluator's inputs.
 * Maps input field identifier -> source mapping.
 */
export type EvaluatorMappings = Record<string, Record<string, FieldMapping>>;
// evaluatorId -> { inputFieldName -> mapping }

// ============================================================================
// Execution Results Types
// ============================================================================

export type EvaluationResultStatus = "idle" | "running" | "success" | "error";

export type EvaluationResults = {
  runId?: string;
  versionId?: string;
  status: EvaluationResultStatus;
  progress?: number;
  total?: number;
  // Per-row results
  agentOutputs: Record<string, unknown[]>; // agentId -> array of outputs per row
  evaluatorResults: Record<string, unknown[]>; // evaluatorId -> array of results per row
  errors: Record<string, string[]>; // agentId/evaluatorId -> array of errors per row
};

// ============================================================================
// UI State Types
// ============================================================================

export type OverlayType =
  | "agent"
  | "evaluator"
  | "dataset-columns"
  | "dataset-switch";

export type CellPosition = {
  row: number;
  columnId: string;
};

export type UIState = {
  openOverlay?: OverlayType;
  overlayTargetId?: string; // which agent/evaluator is being configured
  selectedCell?: CellPosition;
  editingCell?: CellPosition;
  selectedRows: Set<number>;
};

// ============================================================================
// Main State Type
// ============================================================================

export type EvaluationsV3State = {
  // Metadata
  experimentId?: string;
  experimentSlug?: string;
  name: string;

  // Dataset (inline by default)
  dataset: InlineDataset;

  // Agents (multiple for comparison)
  agents: AgentConfig[];
  agentMappings: AgentMappings;

  // Evaluators (multiple)
  evaluators: EvaluatorConfig[];
  evaluatorMappings: EvaluatorMappings;

  // Execution results (populated after run)
  results: EvaluationResults;

  // UI state (not persisted to DSL)
  ui: UIState;
};

// ============================================================================
// Store Actions Types
// ============================================================================

export type EvaluationsV3Actions = {
  // Metadata
  setName: (name: string) => void;
  setExperimentId: (id: string) => void;
  setExperimentSlug: (slug: string) => void;

  // Dataset actions
  setCellValue: (row: number, columnId: string, value: string) => void;
  addColumn: (column: DatasetColumn) => void;
  removeColumn: (columnId: string) => void;
  renameColumn: (columnId: string, newName: string) => void;
  updateColumnType: (columnId: string, type: DatasetColumnType) => void;
  setDataset: (dataset: InlineDataset) => void;
  getRowCount: () => number;

  // Agent actions
  addAgent: (agent: AgentConfig) => void;
  updateAgent: (agentId: string, updates: Partial<AgentConfig>) => void;
  removeAgent: (agentId: string) => void;
  setAgentMapping: (
    agentId: string,
    inputField: string,
    mapping: FieldMapping
  ) => void;

  // Evaluator actions
  addEvaluator: (evaluator: EvaluatorConfig) => void;
  updateEvaluator: (
    evaluatorId: string,
    updates: Partial<EvaluatorConfig>
  ) => void;
  removeEvaluator: (evaluatorId: string) => void;
  setEvaluatorMapping: (
    evaluatorId: string,
    inputField: string,
    mapping: FieldMapping
  ) => void;

  // Results actions
  setResults: (results: Partial<EvaluationResults>) => void;
  clearResults: () => void;

  // UI actions
  openOverlay: (type: OverlayType, targetId?: string) => void;
  closeOverlay: () => void;
  setSelectedCell: (cell: CellPosition | undefined) => void;
  setEditingCell: (cell: CellPosition | undefined) => void;
  toggleRowSelection: (row: number) => void;
  selectAllRows: (rowCount: number) => void;
  clearRowSelection: () => void;

  // Reset
  reset: () => void;
};

export type EvaluationsV3Store = EvaluationsV3State & EvaluationsV3Actions;

// ============================================================================
// Initial State
// ============================================================================

export const createInitialDataset = (): InlineDataset => ({
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  records: {
    input: ["", "", ""],
    expected_output: ["", "", ""],
  },
});

export const createInitialResults = (): EvaluationResults => ({
  status: "idle",
  agentOutputs: {},
  evaluatorResults: {},
  errors: {},
});

export const createInitialUIState = (): UIState => ({
  selectedRows: new Set(),
});

export const createInitialState = (): EvaluationsV3State => ({
  name: "New Evaluation",
  dataset: createInitialDataset(),
  agents: [],
  agentMappings: {},
  evaluators: [],
  evaluatorMappings: {},
  results: createInitialResults(),
  ui: createInitialUIState(),
});
