import { z } from "zod";
import type {
  AutosaveState,
  CellPosition,
  RowHeightMode,
} from "~/components/datasets/editor/DatasetTableContext";
import type { Field } from "~/optimization_studio/types/dsl";
import {
  fieldSchema,
  HTTP_METHODS,
  httpAuthSchema,
  httpHeaderSchema,
} from "~/optimization_studio/types/dsl";
import type { DatasetColumnType } from "@langwatch/contracts/datasets";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators";
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

// fieldSchema is imported from optimization_studio/types/dsl

/**
 * Zod schema for local prompt config validation.
 */
export const localPromptConfigSchema = z.object({
  llm: z.object({
    model: z.string(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    topP: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional(),
    seed: z.number().optional(),
    topK: z.number().optional(),
    minP: z.number().optional(),
    repetitionPenalty: z.number().optional(),
    reasoning: z.string().optional(),
    verbosity: z.string().optional(),
    litellmParams: z.record(z.string(), z.string()).optional(),
  }),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    }),
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
    }),
  ),
  outputs: z.array(
    z.object({
      identifier: z.string(),
      type: z.enum(["str", "float", "bool", "json_schema"]),
      json_schema: z.unknown().optional(),
    }),
  ),
});
export type LocalPromptConfig = z.infer<typeof localPromptConfigSchema>;

/**
 * Zod schema for local evaluator config validation.
 * Stores unsaved evaluator changes (name, settings) locally until the user clicks "Save".
 * Mirrors the localPromptConfig pattern for prompts.
 */
export const localEvaluatorConfigSchema = z.object({
  name: z.string(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type LocalEvaluatorConfig = z.infer<typeof localEvaluatorConfigSchema>;

/**
 * Zod schema for evaluator config validation.
 *
 * Note: Settings are NOT used at execution time - they are always fetched
 * fresh from the database via dbEvaluatorId. This prevents sync issues.
 * The settings field is kept for backward compatibility but is ignored.
 *
 * Mappings are stored per-dataset AND per-target:
 * mappings[datasetId][targetId][inputFieldName] = FieldMapping
 *
 * This allows different mappings for:
 * - Each dataset (same column might have different names)
 * - Each target (target A outputs "output", target B outputs "result")
 */
/**
 * Pairwise evaluator config. Set only for evaluators of type
 * "langevals/pairwise_compare" (and future n-way variants). Picks two
 * existing target columns to compare against a dataset golden field.
 *
 * - variantA / variantB: TargetConfig ids whose per-row outputs are
 *   the two candidates.
 * - hasGoldenAnswer: whether the judge compares against a reference
 *   answer at all (#5378). When false, goldenField is not required —
 *   the judge compares the two candidates directly on their own merits.
 *   Mirrors the evaluator's `settings.has_golden_answer` (source of
 *   truth the judge reads), same dual-representation pattern as
 *   includeMetrics/settings.include_metrics below.
 * - goldenField: dataset field name whose value is the reference answer.
 *   Only meaningful when hasGoldenAnswer is true.
 * - includeMetrics: per-candidate metrics injected into the judge prompt.
 */
export const pairwiseEvaluatorConfigSchema = z.object({
  variantA: z.string(),
  variantB: z.string(),
  /**
   * Optional output-field path for variant A. When the picked variant emits
   * a structured object (e.g. `{answer, confidence}`), the judge shouldn't
   * see the full blob — pick a single subfield here. Empty / omitted means
   * "use the whole output" (the pre-existing behavior — orchestrator paths
   * predating this field must continue to work unchanged).
   */
  variantAOutputPath: z.array(z.string()).optional(),
  variantBOutputPath: z.array(z.string()).optional(),
  hasGoldenAnswer: z.boolean().default(true),
  goldenField: z.string(),
  includeMetrics: z.array(z.enum(["cost", "duration"])).default([]),
});
export type PairwiseEvaluatorConfig = z.infer<
  typeof pairwiseEvaluatorConfigSchema
>;

/**
 * Whether a comparison config's golden-field requirement is satisfied: either
 * a golden field is set, or the user has explicitly opted out of
 * golden-answer comparison (#5378). Checking `hasGoldenAnswer === false`
 * (rather than `!== true`) is deliberate — old saved configs that predate this
 * field have `hasGoldenAnswer` undefined and must still default to
 * golden-required. Single source of truth for the UI gating
 * (EvaluationsV3Table), client validation (mappingValidation), and server
 * cell-generation (orchestrator) call sites — they must never drift.
 */
export function isGoldenFieldSatisfied(config: {
  goldenField?: string;
  hasGoldenAnswer?: boolean;
}): boolean {
  return !!config.goldenField || config.hasGoldenAnswer === false;
}

/**
 * Comparison evaluator config — the single shape behind every column-vs-column
 * preference judgement, whether there are two candidates or ten. Backed by
 * `langevals/select_best_compare`, which handles N=2 without a special case.
 *
 * Supersedes the two-slot `pairwiseEvaluatorConfigSchema` above, which is now
 * read-only legacy: `toComparisonConfig` folds it into this shape on load and
 * nothing writes it again.
 *
 * - variants: ordered TargetConfig ids whose per-row outputs are the
 *   candidates. At least 2 entries required.
 * - variantOutputPaths: per-variant output-field path. When a variant emits a
 *   structured object (e.g. `{answer, confidence}`) the judge shouldn't see the
 *   whole blob — narrow it to one subfield. Missing / empty means "use the
 *   whole output". Generalises pairwise's variantAOutputPath/variantBOutputPath.
 * - hasGoldenAnswer: whether the judge compares against a reference answer at
 *   all. When false, goldenField is not required — the judge compares the
 *   candidates on their own merits (#5378). Mirrors the evaluator's
 *   `settings.has_golden_answer`, same dual-representation pattern as
 *   includeMetrics/settings.include_metrics.
 * - goldenField: dataset field name holding the reference answer. Only
 *   meaningful when hasGoldenAnswer is true.
 * - inputField: optional dataset field used as task/context for the judge.
 *   When omitted, the runtime falls back to the historical auto-detected
 *   `input` column, then the golden field for old datasets.
 * - includeMetrics: per-candidate metrics injected into the judge prompt.
 * - randomizeOrder: when true (default), candidate order is shuffled
 *   deterministically per row (seeded by rowIndex) to mitigate position bias.
 *   Mirrors the Python evaluator's `randomize_order`.
 */
/**
 * The one judge behind every comparison. Kept as a constant so no call site
 * hard-codes the wire slug: the display name is "Comparison", but the
 * langevals module is still `select_best_compare`, and renaming that module
 * would break every saved DB Evaluator row pointing at it.
 *
 * Legacy `langevals/pairwise_compare` rows are still runnable through their own
 * endpoint, but the workbench never creates or dispatches them any more.
 */
export const COMPARISON_EVALUATOR_TYPE = "langevals/select_best_compare";

/** @deprecated Legacy two-slot judge. Read for back-compat; never written. */
export const LEGACY_PAIRWISE_EVALUATOR_TYPE = "langevals/pairwise_compare";

export const comparisonEvaluatorConfigSchema = z.object({
  variants: z.array(z.string()).default([]),
  variantOutputPaths: z.record(z.string(), z.array(z.string())).optional(),
  hasGoldenAnswer: z.boolean().default(false),
  goldenField: z.string().optional(),
  inputField: z.string().optional(),
  includeMetrics: z.array(z.enum(["cost", "duration"])).default([]),
  randomizeOrder: z.boolean().default(true),
});
export type ComparisonEvaluatorConfig = z.infer<
  typeof comparisonEvaluatorConfigSchema
>;

/**
 * Comparison evaluators judge target columns against each other, so they render
 * as their own dedicated verdict column rather than as a chip attached to each
 * target. Everywhere the per-target chip list is built, these must be filtered
 * out — otherwise the same comparison appears once per column and reads as N
 * separate evaluations.
 *
 * Tolerates the legacy `pairwise` shape so that a saved experiment is
 * classified correctly even before `toComparisonConfig` has folded it in.
 */
export const isComparisonEvaluator = (e: {
  pairwise?: unknown;
  comparison?: unknown;
}): boolean => !!e.comparison || !!e.pairwise;

export const evaluatorConfigSchema = z.object({
  id: z.string(),
  evaluatorType: z.string(),
  /** @deprecated Settings are fetched from DB at execution time, not from workbench state */
  settings: z.record(z.string(), z.unknown()).optional(),
  inputs: z.array(fieldSchema),
  // Per-dataset, per-target mappings: datasetId -> targetId -> inputFieldName -> FieldMapping
  mappings: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), fieldMappingSchema)),
  ),
  /** Reference to the database evaluator - settings are fetched from here */
  dbEvaluatorId: z.string().optional(),
  /** Local unsaved evaluator settings that override DB values during execution */
  localEvaluatorConfig: localEvaluatorConfigSchema.optional(),
  /**
   * @deprecated Read-only legacy shape. Saved experiments from before the
   * pairwise/N-way merge carry this; `toComparisonConfig` folds it into
   * `comparison` on load. Never written.
   */
  pairwise: pairwiseEvaluatorConfigSchema.optional(),
  /** Set only for comparison evaluators — the one column-vs-column judge. */
  comparison: comparisonEvaluatorConfigSchema.optional(),
});
export type EvaluatorConfig = Omit<
  z.infer<typeof evaluatorConfigSchema>,
  "evaluatorType" | "inputs"
> & {
  evaluatorType: EvaluatorTypes | `custom/${string}`;
  inputs: Field[];
};

/**
 * Agent types for targets (matches database agent types).
 * Used to determine which type of DSL node to generate.
 */
export const agentTypeEnum = z.enum(["code", "signature", "workflow", "http"]);
export type AgentTypeEnum = z.infer<typeof agentTypeEnum>;

/**
 * HTTP config schema for HTTP agent targets.
 * Stored on the target so DSL adapter can access it without async DB calls.
 */
export const httpConfigSchema = z.object({
  url: z.string(),
  method: z.enum(HTTP_METHODS).default("POST"),
  headers: z.array(httpHeaderSchema).optional(),
  auth: httpAuthSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});
export type HttpConfig = z.infer<typeof httpConfigSchema>;

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
export const targetConfigSchema = z
  .object({
    id: z.string(),
    type: z.enum(["prompt", "agent", "evaluator", "workflow"]),
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
    /**
     * The specific agent type (code, signature, workflow, http).
     * Used by DSL adapter to determine which node type to generate.
     * Only set for agent targets (type === "agent").
     */
    agentType: agentTypeEnum.optional(),
    /**
     * HTTP configuration for HTTP agent targets.
     * Stored on the target so DSL adapter can generate HTTP nodes synchronously.
     * Only set when agentType === "http".
     */
    httpConfig: httpConfigSchema.optional(),
    /**
     * Database evaluator ID for evaluator targets.
     * Used to load evaluator settings from the database at execution time.
     * Only set when type === "evaluator".
     */
    targetEvaluatorId: z.string().optional(),
    /**
     * Local evaluator config for unsaved changes.
     * Stores name and settings modifications until the user clicks "Save".
     * When present, the target header shows an orange dot indicator.
     * Only set when type === "evaluator".
     */
    localEvaluatorConfig: localEvaluatorConfigSchema.optional(),
    /**
     * @deprecated Read-only legacy shape for column-style pairwise targets
     * (#5100). `toComparisonConfig` folds it into `comparison` on load.
     * Never written.
     */
    pairwise: pairwiseEvaluatorConfigSchema.optional(),
    /**
     * Comparison config for column-style comparison targets. Set only when
     * type === "evaluator" AND the underlying evaluator is the comparison
     * judge. Gives the column path a single source of truth for which other
     * targets to compare; per-row input mappings are derived from
     * variants/goldenField at save time and run time. Also drives the
     * target-column Swords icon and the "reuse existing comparison" flow.
     */
    comparison: comparisonEvaluatorConfigSchema.optional(),
    /**
     * Studio workflow target: the committed studio workflow evaluated as a whole
     * per dataset row (distinct from an "agent" target with agentType "workflow",
     * which is a saved agent built as a single code node). Only set when
     * type === "workflow".
     */
    workflowId: z.string().optional(),
    workflowVersionId: z.string().optional(),
    inputs: z.array(fieldSchema).optional(),
    outputs: z.array(fieldSchema).optional(),
    // Per-dataset mappings: datasetId -> inputFieldName -> FieldMapping
    mappings: z.record(z.string(), z.record(z.string(), fieldMappingSchema)),
  })
  .superRefine((value, ctx) => {
    if (value.type === "workflow" && !value.workflowId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflowId"],
        message: "workflowId is required when type is workflow",
      });
    }
  });
export type TargetType = "prompt" | "agent" | "evaluator" | "workflow";
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

export type EvaluationResultStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "stopped";

/**
 * Schema for per-row metadata for a target execution.
 * This is the source of truth - TypeScript type is derived from this.
 */
export const targetRowMetadataSchema = z.object({
  cost: z.number().optional(),
  duration: z.number().optional(),
  traceId: z.string().optional(),
});

/**
 * Per-row metadata for a target execution (cost, duration, trace info).
 * Derived from targetRowMetadataSchema - keeps types in sync automatically.
 */
export type TargetRowMetadata = z.infer<typeof targetRowMetadataSchema>;

export type EvaluationResults = {
  runId?: string;
  versionId?: string;
  status: EvaluationResultStatus;
  progress?: number;
  total?: number;
  /**
   * Set of cells currently being executed (waiting for target output).
   * Key format: "rowIndex:targetId"
   * Used to show loading skeleton on target cells.
   */
  executingCells?: Set<string>;
  /**
   * Set of evaluators currently running (waiting for evaluator result).
   * Key format: "rowIndex:targetId:evaluatorId"
   * Used to show spinner on evaluator chips.
   */
  runningEvaluators?: Set<string>;
  // Per-row results - arrays can have holes (undefined) for rows not yet executed
  targetOutputs: Record<string, Array<unknown>>;
  // Per-row metadata - arrays can have holes (undefined/null) for rows not yet executed
  targetMetadata: Record<string, Array<TargetRowMetadata | null | undefined>>;
  // Evaluator results nested by target - arrays can have holes
  evaluatorResults: Record<string, Record<string, Array<unknown>>>;
  // Per-row errors - arrays can have holes (undefined) for rows without errors
  errors: Record<string, Array<string | null | undefined>>;
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
  // Which target column is highlighted via clicking a variant name in a
  // pairwise / N-way verdict (glow effect on that column's header).
  highlightedVariantTargetId?: string;
  // Whether the highlighted column was the winner or a loser of the verdict
  // that was clicked. Drives the glow colour and the "Won" badge on the
  // target header. Undefined for a tie (or when nothing is highlighted).
  highlightedVariantOutcome?: "won" | "lost";
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
  // Concurrency limit for parallel execution (default 10)
  concurrency: number;
  // Whether an evaluation has been run this session (enables History button)
  hasRunThisSession: boolean;
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
  updateDataset: (
    datasetId: string,
    updates: Partial<DatasetReference>,
  ) => void;
  exportInlineToSaved: (datasetId: string, savedDatasetId: string) => void;

  // Dataset cell/column actions (works for both inline and saved)
  setCellValue: (
    datasetId: string,
    row: number,
    columnId: string,
    value: string,
  ) => void;
  getCellValue: (datasetId: string, row: number, columnId: string) => string;
  getRowCount: (datasetId: string) => number;

  // Saved dataset actions
  updateSavedRecordValue: (
    datasetId: string,
    rowIndex: number,
    columnId: string,
    value: string,
  ) => void;
  clearPendingChange: (dbDatasetId: string, recordId: string) => void;
  getSavedRecordInfo: (
    datasetId: string,
    rowIndex: number,
  ) => {
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
    type: DatasetColumnType,
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
    mapping: FieldMapping,
  ) => void;
  /** Remove a mapping for a target input field for a specific dataset */
  removeTargetMapping: (
    targetId: string,
    datasetId: string,
    inputField: string,
  ) => void;
  /**
   * Comparison column-target: write the high-level comparison config and
   * deterministically derive the per-row field mappings on the same target.
   * Leaves non-comparison targets untouched.
   */
  updateTargetComparison: (
    targetId: string,
    comparison: ComparisonEvaluatorConfig,
  ) => void;

  // Global evaluator actions (evaluators apply to ALL targets automatically)
  addEvaluator: (evaluator: EvaluatorConfig) => void;
  updateEvaluator: (
    evaluatorId: string,
    updates: Partial<EvaluatorConfig>,
  ) => void;
  removeEvaluator: (evaluatorId: string) => void;

  /** Set a mapping for an evaluator input field for a specific dataset and target */
  setEvaluatorMapping: (
    evaluatorId: string,
    datasetId: string,
    targetId: string,
    inputField: string,
    mapping: FieldMapping,
  ) => void;
  /** Remove a mapping for an evaluator input field for a specific dataset and target */
  removeEvaluatorMapping: (
    evaluatorId: string,
    datasetId: string,
    targetId: string,
    inputField: string,
  ) => void;

  // Results actions
  setResults: (results: Partial<EvaluationResults>) => void;
  clearResults: () => void;

  // UI actions
  openOverlay: (
    type: OverlayType,
    targetId?: string,
    evaluatorId?: string,
  ) => void;
  closeOverlay: () => void;
  setSelectedCell: (cell: CellPosition | undefined) => void;
  setEditingCell: (cell: CellPosition | undefined) => void;
  setHighlightedVariantTargetId: (
    targetId: string | undefined,
    outcome?: "won" | "lost",
  ) => void;
  toggleRowSelection: (row: number) => void;
  selectAllRows: (rowCount: number) => void;
  clearRowSelection: () => void;
  deleteSelectedRows: (datasetId: string) => void;
  setExpandedEvaluator: (
    expanded:
      | { targetId: string; evaluatorId: string; row: number }
      | undefined,
  ) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  setColumnWidths: (widths: Record<string, number>) => void;
  setRowHeightMode: (mode: RowHeightMode) => void;
  setConcurrency: (concurrency: number) => void;
  toggleCellExpanded: (row: number, columnId: string) => void;
  toggleColumnVisibility: (columnName: string) => void;
  setHiddenColumns: (columnNames: Set<string>) => void;
  setAutosaveStatus: (
    type: "evaluation" | "dataset",
    state: AutosaveState,
    error?: string,
  ) => void;

  // Reset
  reset: () => void;

  // Load state from saved experiment
  loadState: (workbenchState: unknown) => void;

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
  /**
   * True when the dataset row contains no user-entered values. The table
   * always renders a trailing empty row for Excel-style "click to add,"
   * but that phantom row must not show target outputs or evaluator chips.
   *
   * Required (non-optional) — every TableRowData built by the rowData
   * builder in EvaluationsV3Table.tsx sets this. Was briefly optional during
   * the #3441 sweep because DatasetSection/TableCell.tsx carried a parallel
   * RowData shape without the field; that parallel shape has been unified
   * with this type (#3460 item 5), so the optional can go.
   */
  isEmpty: boolean;
  targets: Record<
    string,
    {
      output: unknown;
      evaluators: Record<string, unknown>;
      error?: string | null;
      isLoading?: boolean;
    }
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
  handleDuplicateTarget: (target: TargetConfig) => void;
  handleSwitchTarget: (target: TargetConfig) => void;
  handleRemoveTarget: (targetId: string) => void;
  handleAddEvaluator: () => void;
  // Execution handlers
  handleRunTarget?: (targetId: string) => void;
  handleRunRow?: (rowIndex: number) => void;
  handleRunCell?: (rowIndex: number, targetId: string) => void;
  /** Re-run a single evaluator for a specific cell */
  handleRerunEvaluator?: (
    rowIndex: number,
    targetId: string,
    evaluatorId: string,
  ) => void;
  /** Run an evaluator on all rows that have target outputs */
  handleRunEvaluatorOnAllRows?: (targetId: string, evaluatorId: string) => void;
  /** Check if any row has a target output for a given target */
  hasAnyTargetOutputs?: (targetId: string) => boolean;
  handleStopExecution?: () => void;
  /** Whether any execution is currently running */
  isExecutionRunning?: boolean;
  /** Check if a specific target has cells being executed */
  isTargetExecuting?: (targetId: string) => boolean;
  /** Check if a specific cell is being executed */
  isCellExecuting?: (rowIndex: number, targetId: string) => boolean;
  /** Check if a specific evaluator is currently running */
  isEvaluatorRunning?: (
    rowIndex: number,
    targetId: string,
    evaluatorId: string,
  ) => boolean;
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
    input: [
      "How do I update my billing information?",
      "I'm having trouble logging into my account",
      "What are your business hours?",
    ],
    expected_output: [
      "You can update your billing information by going to Settings > Billing in your account dashboard. From there, click 'Edit Payment Method' to make changes. Let me know if you need any help!",
      "I'm sorry to hear you're having trouble logging in. Let's get this sorted out. Could you try resetting your password using the 'Forgot Password' link on the login page? If that doesn't work, let me know and I can help further.",
      "We're available Monday through Friday, 9 AM to 6 PM in your local timezone. You can also reach us anytime through this chat or by email at support@company.com.",
    ],
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
  targetMetadata: {},
  evaluatorResults: {},
  errors: {},
});

// Default concurrency limit for parallel execution
export const DEFAULT_CONCURRENCY = 10;

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
  concurrency: DEFAULT_CONCURRENCY,
  hasRunThisSession: false,
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
