import { z } from "zod";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { Field } from "~/optimization_studio/types/dsl";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";

// ============================================================================
// Zod Schemas (source of truth - types are inferred from these)
// ============================================================================

/**
 * Zod schema for field mapping validation.
 * Discriminated union: source mapping OR value mapping.
 */
export const fieldMappingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    source: z.enum(["dataset", "target"]),
    sourceId: z.string(),
    sourceField: z.string(),
  }),
  z.object({
    type: z.literal("value"),
    value: z.string(),
  }),
]);
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

/**
 * Zod schema for dataset column validation.
 * Runtime validation is permissive (string), TypeScript type is strict.
 */
export const datasetColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(), // Allow any string at runtime since DatasetColumnType has many values
});
// TypeScript type uses the strict DatasetColumnType
export type DatasetColumn = {
  id: string;
  name: string;
  type: DatasetColumnType;
};

/**
 * Zod schema for inline dataset validation.
 */
export const inlineDatasetSchema = z.object({
  columns: z.array(datasetColumnSchema),
  records: z.record(z.string(), z.array(z.string())),
});
export type InlineDataset = {
  columns: DatasetColumn[];
  records: Record<string, string[]>;
};

/**
 * Zod schema for saved record validation.
 */
export const savedRecordSchema = z
  .object({
    id: z.string(),
  })
  .passthrough();
export type SavedRecord = { id: string } & Record<string, unknown>;

/**
 * Zod schema for dataset reference validation.
 */
export const datasetReferenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["inline", "saved"]),
  inline: inlineDatasetSchema.optional(),
  datasetId: z.string().optional(),
  columns: z.array(datasetColumnSchema),
  savedRecords: z.array(savedRecordSchema).optional(),
});
export type DatasetReference = {
  id: string;
  name: string;
  type: "inline" | "saved";
  inline?: InlineDataset;
  datasetId?: string;
  columns: DatasetColumn[];
  savedRecords?: SavedRecord[];
};

/**
 * Zod schema for field validation (from optimization studio).
 */
export const fieldSchema = z.object({
  identifier: z.string(),
  type: z.string(),
  value: z.unknown().optional(),
});

/**
 * Zod schema for local prompt config validation.
 */
export const localPromptConfigSchema = z.object({
  llm: z.object({
    model: z.string(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    litellmParams: z.record(z.string(), z.string()).optional(),
  }),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  inputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.enum([
        "str",
        "float",
        "bool",
        "image",
        "list[str]",
        "list[float]",
        "list[int]",
        "list[bool]",
        "dict",
        "list",
      ]),
    })
  ),
  outputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.enum(["str", "float", "bool", "json_schema"]),
      json_schema: z.unknown().optional(),
    })
  ),
});
export type LocalPromptConfig = z.infer<typeof localPromptConfigSchema>;

/**
 * Zod schema for evaluator config validation.
 *
 * Mappings are stored per-dataset AND per-target:
 * mappings[datasetId][targetId][inputFieldName] = FieldMapping
 *
 * This allows different mappings for:
 * - Each dataset (same column might have different names)
 * - Each target (target A outputs "output", target B outputs "result")
 */
export const evaluatorConfigSchema = z.object({
  id: z.string(),
  evaluatorType: z.string(),
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  inputs: z.array(fieldSchema),
  // Per-dataset, per-target mappings: datasetId -> targetId -> inputFieldName -> FieldMapping
  mappings: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), fieldMappingSchema))
  ),
  dbEvaluatorId: z.string().optional(),
});
export type EvaluatorConfig = Omit<
  z.infer<typeof evaluatorConfigSchema>,
  "evaluatorType" | "inputs"
> & {
  evaluatorType: EvaluatorTypes | `custom/${string}`;
  inputs: Field[];
};

/**
 * Zod schema for target config validation.
 *
 * Mappings are stored per-dataset:
 * mappings[datasetId][inputFieldName] = FieldMapping
 *
 * This allows different mappings for each dataset in the evaluation.
 *
 * Note: Evaluators are NOT tied to targets. All evaluators in the store
 * apply to ALL targets. Only the mappings differ per target (and per dataset).
 */
export const targetConfigSchema = z.object({
  id: z.string(),
  type: z.enum(["prompt", "agent"]),
  name: z.string(),
  icon: z.string().optional(),
  promptId: z.string().optional(),
  promptVersionId: z.string().optional(),
  /**
   * The version number currently loaded for this target.
   * Used for:
   * - Displaying version badge in UI
   * - Comparing with latest DB version to detect outdated status
   * - When undefined + no localPromptConfig, target "follows latest" automatically
   * - When set + has localPromptConfig, target is "pinned" to this version
   */
  promptVersionNumber: z.number().optional(),
  localPromptConfig: localPromptConfigSchema.optional(),
  dbAgentId: z.string().optional(),
  inputs: z.array(fieldSchema).optional(),
  outputs: z.array(fieldSchema).optional(),
  // Per-dataset mappings: datasetId -> inputFieldName -> FieldMapping
  mappings: z.record(z.string(), z.record(z.string(), fieldMappingSchema)),
});
export type TargetType = "prompt" | "agent";
export type TargetConfig = Omit<
  z.infer<typeof targetConfigSchema>,
  "inputs" | "outputs"
> & {
  inputs: Field[];
  outputs: Field[];
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
  targetOutputs: Record<string, unknown[]>; // targetId -> array of outputs per row
  // Evaluator results nested by target
  evaluatorResults: Record<string, Record<string, unknown[]>>; // targetId -> evaluatorId -> array of results per row
  errors: Record<string, string[]>; // targetId -> array of errors per row
};

// ============================================================================
// UI State Types
// ============================================================================

export type OverlayType =
  | "target"
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
  overlayTargetId?: string; // which target is being configured
  overlayEvaluatorId?: string; // which evaluator within the target (for evaluator overlay)
  selectedCell?: CellPosition;
  editingCell?: CellPosition;
  selectedRows: Set<number>;
  expandedEvaluator?: {
    targetId: string;
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
  // Each evaluator contains per-target mappings inside it
  evaluators: EvaluatorConfig[];

  // Targets (multiple for comparison) - reference evaluators by ID
  // Target mappings are inside each target
  targets: TargetConfig[];

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

  // Target actions
  addTarget: (target: TargetConfig) => void;
  updateTarget: (targetId: string, updates: Partial<TargetConfig>) => void;
  removeTarget: (targetId: string) => void;
  /** Set a mapping for a target input field for a specific dataset */
  setTargetMapping: (
    targetId: string,
    datasetId: string,
    inputField: string,
    mapping: FieldMapping
  ) => void;
  /** Remove a mapping for a target input field for a specific dataset */
  removeTargetMapping: (
    targetId: string,
    datasetId: string,
    inputField: string
  ) => void;

  // Global evaluator actions (evaluators apply to ALL targets automatically)
  addEvaluator: (evaluator: EvaluatorConfig) => void;
  updateEvaluator: (
    evaluatorId: string,
    updates: Partial<EvaluatorConfig>
  ) => void;
  removeEvaluator: (evaluatorId: string) => void;

  /** Set a mapping for an evaluator input field for a specific dataset and target */
  setEvaluatorMapping: (
    evaluatorId: string,
    datasetId: string,
    targetId: string,
    inputField: string,
    mapping: FieldMapping
  ) => void;
  /** Remove a mapping for an evaluator input field for a specific dataset and target */
  removeEvaluatorMapping: (
    evaluatorId: string,
    datasetId: string,
    targetId: string,
    inputField: string
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
    expanded: { targetId: string; evaluatorId: string; row: number } | undefined
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
// Table Types (TanStack Table)
// ============================================================================

/**
 * Row data structure for the evaluations table.
 * Each row contains dataset values and target outputs.
 */
export type TableRowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  targets: Record<
    string,
    { output: unknown; evaluators: Record<string, unknown> }
  >;
};

/**
 * Table meta - used to pass dynamic data to column headers/cells
 * without causing column definition changes (which would remount components).
 *
 * IMPORTANT: All dynamic data must go through meta to keep columns stable.
 * If columns change, TanStack Table will remount all headers.
 */
export type TableMeta = {
  // Target data
  targets: TargetConfig[];
  targetsMap: Map<string, TargetConfig>;
  evaluatorsMap: Map<string, EvaluatorConfig>;
  openTargetEditor: (target: TargetConfig) => void;
  handleRemoveTarget: (targetId: string) => void;
  handleAddEvaluator: () => void;
  // Selection data (for checkbox column)
  selectedRows: Set<number>;
  allSelected: boolean;
  someSelected: boolean;
  rowCount: number;
  toggleRowSelection: (rowIndex: number) => void;
  selectAllRows: (count: number) => void;
  clearRowSelection: () => void;
};

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
  targetOutputs: {},
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
  targets: [],
  results: createInitialResults(),
  pendingSavedChanges: {},
  ui: createInitialUIState(),
});
