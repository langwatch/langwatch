import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { ChatMessage } from "~/server/tracer/types";
import type { Field, LLMConfig } from "~/optimization_studio/types/dsl";

// ============================================================================
// Dataset Types
// ============================================================================

export type DatasetColumn = {
  id: string;
  name: string;
  type: DatasetColumnType;
};

/**
 * Inline dataset data - stored directly in state.
 * Used for the default "Test Data" or newly created datasets.
 */
export type InlineDataset = {
  columns: DatasetColumn[];
  records: Record<string, string[]>; // columnId -> array of values per row
};

/**
 * A single saved record from the database.
 * The `id` is the record ID from the DB, other fields are column values.
 */
export type SavedRecord = {
  id: string;
} & Record<string, unknown>;

/**
 * A dataset reference in the workbench.
 * Can be either inline (data stored here) or saved (reference to DB).
 */
export type DatasetReference = {
  id: string; // Unique ID in workbench (e.g., "test-data" or ksuid)
  name: string; // Display name (tab label)
  type: "inline" | "saved";
  // For inline datasets - contains the actual data
  inline?: InlineDataset;
  // For saved datasets - reference to DB dataset ID
  datasetId?: string;
  // Cached columns for mapping UI (always present)
  columns: DatasetColumn[];
  // For saved datasets - cached records from DB (loaded when added to workbench)
  savedRecords?: SavedRecord[];
};

// ============================================================================
// Mapping Types (defined first as other types use them)
// ============================================================================

/**
 * Maps a target field to a source field.
 * Source can be "dataset" (with datasetId) or "agent" (with agentId).
 */
export type FieldMapping = {
  source: "dataset" | "agent";
  sourceId: string; // dataset ID or agent ID
  sourceField: string;
};

// ============================================================================
// Evaluator Types (global/shared, will be stored in DB in future)
// ============================================================================

/**
 * Global evaluator configuration.
 * Evaluators are shared across agents - agents reference them by ID.
 * Per-agent mappings are stored inside the evaluator for easy access in the global panel.
 * When generating DSL, evaluators are duplicated per-agent with {agentId}.{evaluatorId} naming.
 */
export type EvaluatorConfig = {
  id: string;
  evaluatorType: EvaluatorTypes | `custom/${string}`;
  name: string;
  settings: Record<string, unknown>;
  inputs: Field[];
  // Per-agent input mappings for this evaluator
  // agentId -> { inputFieldName -> mapping }
  mappings: Record<string, Record<string, FieldMapping>>;
  // Reference to database-backed evaluator (if using saved evaluator)
  dbEvaluatorId?: string;
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

  // Reference to database-backed agent (if using saved agent)
  dbAgentId?: string;

  // For LLM (mirrors LlmPromptConfigComponent structure)
  llmConfig?: LLMConfig;
  messages?: ChatMessage[];
  instructions?: string;

  // For Code (mirrors Code node structure)
  code?: string;

  // Common
  inputs: Field[];
  outputs: Field[];

  // Agent input mappings (how agent inputs connect to dataset/other agents)
  // inputFieldName -> mapping
  mappings: Record<string, FieldMapping>;

  // References to global evaluators by ID
  evaluatorIds: string[];
};

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
  // Evaluator results nested by agent
  evaluatorResults: Record<string, Record<string, unknown[]>>; // agentId -> evaluatorId -> array of results per row
  errors: Record<string, string[]>; // agentId -> array of errors per row
};

// ============================================================================
// UI State Types
// ============================================================================

export type OverlayType =
  | "agent"
  | "evaluator"
  | "dataset-columns"
  | "dataset-switch"
  | "dataset-add";

export type CellPosition = {
  row: number;
  columnId: string;
};

export type RowHeightMode = "compact" | "expanded";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

export type AutosaveStatus = {
  evaluation: AutosaveState;
  dataset: AutosaveState;
  evaluationError?: string;
  datasetError?: string;
};

export type UIState = {
  openOverlay?: OverlayType;
  overlayTargetId?: string; // which agent is being configured
  overlayEvaluatorId?: string; // which evaluator within the agent (for evaluator overlay)
  selectedCell?: CellPosition;
  editingCell?: CellPosition;
  selectedRows: Set<number>;
  expandedEvaluator?: {
    agentId: string;
    evaluatorId: string;
    row: number;
  };
  // Column widths for resizing (columnId -> width in pixels)
  columnWidths: Record<string, number>;
  // Row height mode: compact shows limited height with fade, expanded shows all
  rowHeightMode: RowHeightMode;
  // Cells that are individually expanded in compact mode (row-columnId keys)
  expandedCells: Set<string>;
  // Hidden columns by name (not persisted to dataset, just UI state)
  hiddenColumns: Set<string>;
  // Autosave status for evaluation state and dataset records
  autosaveStatus: AutosaveStatus;
};

// ============================================================================
// Main State Type
// ============================================================================

export type EvaluationsV3State = {
  // Metadata
  experimentId?: string;
  experimentSlug?: string;
  name: string;

  // Multiple datasets with active selection
  datasets: DatasetReference[];
  activeDatasetId: string;

  // Global evaluators (shared definitions, will be stored in DB in future)
  // Each evaluator contains per-agent mappings inside it
  evaluators: EvaluatorConfig[];

  // Agents (multiple for comparison) - reference evaluators by ID
  // Agent mappings are inside each agent
  agents: AgentConfig[];

  // Execution results (populated after run)
  results: EvaluationResults;

  // Pending changes for saved datasets (datasetId -> recordId -> field changes)
  // These are local changes that need to be synced to the DB
  pendingSavedChanges: Record<string, Record<string, Record<string, unknown>>>;

  // UI state (not persisted)
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

  // Dataset management actions
  addDataset: (dataset: DatasetReference) => void;
  removeDataset: (datasetId: string) => void;
  setActiveDataset: (datasetId: string) => void;
  updateDataset: (datasetId: string, updates: Partial<DatasetReference>) => void;
  exportInlineToSaved: (datasetId: string, savedDatasetId: string) => void;

  // Dataset cell/column actions (works for both inline and saved)
  setCellValue: (
    datasetId: string,
    row: number,
    columnId: string,
    value: string
  ) => void;
  getCellValue: (datasetId: string, row: number, columnId: string) => string;
  getRowCount: (datasetId: string) => number;

  // Saved dataset actions
  updateSavedRecordValue: (
    datasetId: string,
    rowIndex: number,
    columnId: string,
    value: string
  ) => void;
  clearPendingChange: (dbDatasetId: string, recordId: string) => void;
  getSavedRecordInfo: (datasetId: string, rowIndex: number) => {
    dbDatasetId: string;
    recordId: string;
  } | null;

  // Inline dataset column actions
  addColumn: (datasetId: string, column: DatasetColumn) => void;
  removeColumn: (datasetId: string, columnId: string) => void;
  renameColumn: (datasetId: string, columnId: string, newName: string) => void;
  updateColumnType: (
    datasetId: string,
    columnId: string,
    type: DatasetColumnType
  ) => void;

  // Agent actions
  addAgent: (agent: AgentConfig) => void;
  updateAgent: (agentId: string, updates: Partial<AgentConfig>) => void;
  removeAgent: (agentId: string) => void;
  setAgentMapping: (
    agentId: string,
    inputField: string,
    mapping: FieldMapping
  ) => void;

  // Global evaluator actions
  addEvaluator: (evaluator: EvaluatorConfig) => void;
  updateEvaluator: (
    evaluatorId: string,
    updates: Partial<EvaluatorConfig>
  ) => void;
  removeEvaluator: (evaluatorId: string) => void;

  // Agent-evaluator relationship actions
  addEvaluatorToAgent: (agentId: string, evaluatorId: string) => void;
  removeEvaluatorFromAgent: (agentId: string, evaluatorId: string) => void;

  // Evaluator mapping actions (per-agent mappings stored inside evaluator)
  setEvaluatorMapping: (
    evaluatorId: string,
    agentId: string,
    inputField: string,
    mapping: FieldMapping
  ) => void;

  // Results actions
  setResults: (results: Partial<EvaluationResults>) => void;
  clearResults: () => void;

  // UI actions
  openOverlay: (
    type: OverlayType,
    targetId?: string,
    evaluatorId?: string
  ) => void;
  closeOverlay: () => void;
  setSelectedCell: (cell: CellPosition | undefined) => void;
  setEditingCell: (cell: CellPosition | undefined) => void;
  toggleRowSelection: (row: number) => void;
  selectAllRows: (rowCount: number) => void;
  clearRowSelection: () => void;
  deleteSelectedRows: (datasetId: string) => void;
  setExpandedEvaluator: (
    expanded: { agentId: string; evaluatorId: string; row: number } | undefined
  ) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  setColumnWidths: (widths: Record<string, number>) => void;
  setRowHeightMode: (mode: RowHeightMode) => void;
  toggleCellExpanded: (row: number, columnId: string) => void;
  toggleColumnVisibility: (columnName: string) => void;
  setHiddenColumns: (columnNames: Set<string>) => void;
  setAutosaveStatus: (
    type: "evaluation" | "dataset",
    state: AutosaveState,
    error?: string
  ) => void;

  // Reset
  reset: () => void;

  // Load state from saved experiment
  loadState: (wizardState: unknown) => void;

  // Update saved dataset records (used when loading from database)
  setSavedDatasetRecords: (datasetId: string, records: SavedRecord[]) => void;
};

export type EvaluationsV3Store = EvaluationsV3State & EvaluationsV3Actions;

// ============================================================================
// Initial State
// ============================================================================

export const DEFAULT_TEST_DATA_ID = "test-data";

export const createInitialInlineDataset = (): InlineDataset => ({
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  records: {
    input: ["", "", ""],
    expected_output: ["", "", ""],
  },
});

export const createInitialDataset = (): DatasetReference => ({
  id: DEFAULT_TEST_DATA_ID,
  name: "Test Data",
  type: "inline",
  inline: createInitialInlineDataset(),
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
});

export const createInitialResults = (): EvaluationResults => ({
  status: "idle",
  agentOutputs: {},
  evaluatorResults: {},
  errors: {},
});

export const createInitialUIState = (): UIState => ({
  selectedRows: new Set(),
  columnWidths: {},
  rowHeightMode: "compact",
  expandedCells: new Set(),
  hiddenColumns: new Set(),
  autosaveStatus: {
    evaluation: "idle",
    dataset: "idle",
  },
});

export const createInitialState = (): EvaluationsV3State => ({
  name: "New Evaluation",
  datasets: [createInitialDataset()],
  activeDatasetId: DEFAULT_TEST_DATA_ID,
  evaluators: [],
  agents: [],
  results: createInitialResults(),
  pendingSavedChanges: {},
  ui: createInitialUIState(),
});
