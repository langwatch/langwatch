import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { Field } from "~/optimization_studio/types/dsl";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";

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
 * Source can be "dataset" (with datasetId) or "runner" (with runnerId).
 */
export type FieldMapping = {
  source: "dataset" | "runner";
  sourceId: string; // dataset ID or runner ID
  sourceField: string;
};

// ============================================================================
// Evaluator Types (global/shared, will be stored in DB in future)
// ============================================================================

/**
 * Global evaluator configuration.
 * Evaluators are shared across runners - runners reference them by ID.
 * Per-runner mappings are stored inside the evaluator for easy access in the global panel.
 * When generating DSL, evaluators are duplicated per-runner with {runnerId}.{evaluatorId} naming.
 */
export type EvaluatorConfig = {
  id: string;
  evaluatorType: EvaluatorTypes | `custom/${string}`;
  name: string;
  settings: Record<string, unknown>;
  inputs: Field[];
  // Per-runner input mappings for this evaluator
  // runnerId -> { inputFieldName -> mapping }
  mappings: Record<string, Record<string, FieldMapping>>;
  // Reference to database-backed evaluator (if using saved evaluator)
  dbEvaluatorId?: string;
};

// ============================================================================
// Runner Types
// ============================================================================

/**
 * Runner type - either a versioned prompt or an agent (code/workflow)
 */
export type RunnerType = "prompt" | "agent";

/**
 * Local prompt configuration for unpublished modifications.
 * Stores the prompt config locally in the runner without publishing a new version.
 * Used for quick tinkering - allows running evaluations against modified prompts
 * without committing to the versioning system.
 */
export type LocalPromptConfig = {
  llm: {
    model: string;
    temperature?: number;
    maxTokens?: number;
    litellmParams?: Record<string, string>;
  };
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  inputs: Array<{ identifier: string; type: LlmConfigInputType }>;
  outputs: Array<{
    identifier: string;
    type: LlmConfigOutputType;
    json_schema?: unknown;
  }>;
};

/**
 * Runner configuration - unified type for prompts and agents in evaluations.
 * A runner can be either:
 * - A Prompt: references a versioned prompt from the Prompts system
 * - An Agent: references a saved agent (code or workflow type)
 */
export type RunnerConfig = {
  id: string;
  type: RunnerType;
  name: string;
  icon?: string;

  // For prompts - reference to versioned prompt from Prompts system
  promptId?: string;
  promptVersionId?: string;

  // For prompts - local unpublished modifications
  // When set, this config is used for evaluation instead of the published version.
  // Allows quick tinkering without committing to the versioning system.
  localPromptConfig?: LocalPromptConfig;

  // For agents - reference to database-backed agent (code or workflow)
  // Agent type and workflow ID are fetched at runtime via dbAgentId
  dbAgentId?: string;

  // Common fields
  inputs: Field[];
  outputs: Field[];

  // Runner input mappings (how runner inputs connect to dataset/other runners)
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
  runnerOutputs: Record<string, unknown[]>; // runnerId -> array of outputs per row
  // Evaluator results nested by runner
  evaluatorResults: Record<string, Record<string, unknown[]>>; // runnerId -> evaluatorId -> array of results per row
  errors: Record<string, string[]>; // runnerId -> array of errors per row
};

// ============================================================================
// UI State Types
// ============================================================================

export type OverlayType =
  | "runner"
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
  overlayTargetId?: string; // which runner is being configured
  overlayEvaluatorId?: string; // which evaluator within the runner (for evaluator overlay)
  selectedCell?: CellPosition;
  editingCell?: CellPosition;
  selectedRows: Set<number>;
  expandedEvaluator?: {
    runnerId: string;
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
  // Each evaluator contains per-runner mappings inside it
  evaluators: EvaluatorConfig[];

  // Runners (multiple for comparison) - reference evaluators by ID
  // Runner mappings are inside each runner
  runners: RunnerConfig[];

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

  // Runner actions
  addRunner: (runner: RunnerConfig) => void;
  updateRunner: (runnerId: string, updates: Partial<RunnerConfig>) => void;
  removeRunner: (runnerId: string) => void;
  setRunnerMapping: (
    runnerId: string,
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

  // Runner-evaluator relationship actions
  addEvaluatorToRunner: (runnerId: string, evaluatorId: string) => void;
  removeEvaluatorFromRunner: (runnerId: string, evaluatorId: string) => void;

  // Evaluator mapping actions (per-runner mappings stored inside evaluator)
  setEvaluatorMapping: (
    evaluatorId: string,
    runnerId: string,
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
    expanded: { runnerId: string; evaluatorId: string; row: number } | undefined
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
  runnerOutputs: {},
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
  runners: [],
  results: createInitialResults(),
  pendingSavedChanges: {},
  ui: createInitialUIState(),
});
