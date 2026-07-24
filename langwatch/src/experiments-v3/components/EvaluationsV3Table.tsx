import { Box, HStack, Link, Text } from "@chakra-ui/react";
import {
  type ColumnDef,
  type ColumnSizingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { datasetTableCss } from "~/components/datasets/editor/datasetTableStyles";
import type { ColumnType } from "~/components/datasets/editor/TableCell";
import { useTableKeyboardNavigation } from "~/components/datasets/editor/useTableKeyboardNavigation";
import { VirtualizedTableBody } from "~/components/datasets/editor/VirtualizedTableBody";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import {
  getFlowCallbacks,
  setComplexProps,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  Field,
  HttpComponentConfig,
} from "~/optimization_studio/types/dsl";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { DatasetColumnType } from "~/server/datasets/types";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators";
import type {
  EvaluatorField,
  EvaluatorWithFields,
} from "~/server/evaluators/evaluator.service";
import { api } from "~/utils/api";
import { DRAWER_WIDTH } from "../constants";
import { resolveTargetNameFromCache } from "../hooks/resolveTargetName";
import { useDatasetSync } from "../hooks/useDatasetSync";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useExecuteEvaluation } from "../hooks/useExecuteEvaluation";
import { useOpenEvaluatorEditor } from "../hooks/useOpenEvaluatorEditor";
import {
  scrollToTargetColumn,
  useOpenTargetEditor,
} from "../hooks/useOpenTargetEditor";
import { useDatasetSelectionLoader } from "../hooks/useSavedDatasetLoader";
import type {
  ComparisonEvaluatorConfig,
  DatasetColumn,
  DatasetReference,
  EvaluationResults,
  EvaluatorConfig,
  FieldMapping,
  SavedRecord,
  TableMeta,
  TableRowData,
  TargetConfig,
} from "../types";
import {
  COMPARISON_EVALUATOR_TYPE,
  isGoldenFieldSatisfied,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
} from "../types";
import { convertInlineToRowRecords } from "../utils/datasetConversion";
import { isRowEmpty } from "../utils/emptyRowDetection";
import { createEvaluatorEditorCallbacks } from "../utils/evaluatorEditorCallbacks";
import { isCellInExecution } from "../utils/executionScope";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../utils/fieldMappingConverters";
import {
  buildInputsFromBodyTemplate,
  convertHttpComponentConfig,
} from "../utils/httpAgentUtils";
import { evaluatorHasMissingMappings } from "../utils/mappingValidation";
import { executeForkAgentDuplicate } from "../utils/executeForkAgentDuplicate";
import {
  toTargetOutputFields,
  type PromptOutputField,
} from "../utils/targetOutputFields";
import { toComparisonConfig } from "../utils/normalizeComparison";
import { createPromptEditorCallbacks } from "../utils/promptEditorCallbacks";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import { DatasetSuperHeader } from "./DatasetSuperHeader";
import { EvaluationsV3DatasetTableProvider } from "./EvaluationsV3DatasetTableProvider";
import { ComparisonCell } from "./ComparisonCell";
import { ComparisonColumnHeader } from "./ComparisonColumnHeader";
import { SelectionToolbar } from "./SelectionToolbar";
import {
  CheckboxCellFromMeta,
  CheckboxHeaderFromMeta,
  TargetCellFromMeta,
  TargetHeaderFromMeta,
} from "./TableMetaWrappers";
import { TargetSuperHeader } from "./TargetSuperHeader";

// Max rows for expanded mode (disable virtualization above this)
const MAX_ROWS_FOR_FIT_MODE = 100;

// Default percentage widths for columns (stored as numbers, e.g., 16 means 16%)
const CHECKBOX_WIDTH_PX = 40; // Checkbox is fixed pixels
const DATASET_COL_DEFAULT_PCT = 16;
const TARGET_COL_DEFAULT_PCT = 20;
/**
 * A comparison column carries strictly more header content than a prompt/agent
 * column — its name, the "<winner> wins" verdict, latency, cost AND the run
 * button all share one row, where a prompt column has only name + summary + run.
 * An equal 20% share starves it: measured at a 1440px viewport its own name
 * truncated by 40px while every sibling still had slack.
 *
 * 24% was picked by measurement, not taste: it cuts that truncation to ~17px
 * while leaving sibling columns at 0-3px (26% fixed the comparison almost
 * entirely but started truncating the siblings — robbing Peter to pay Paul).
 * This does not promise a name never truncates; a long enough name always will,
 * and the column stays user-resizable. It just stops the column with the most
 * to say from being the one given the least room to say it.
 */
const COMPARISON_COL_DEFAULT_PCT = 24;
const COMPARISON_COL_MIN_PCT = 14;

/**
 * Type for the config stored in DB Evaluator.config field.
 * The DB stores evaluatorType and settings - inputs are derived from
 * the evaluator definition at runtime, not stored in DB.
 */
type EvaluatorDbConfig = {
  evaluatorType?: EvaluatorTypes;
  settings?: Record<string, unknown>;
};

// A comparison evaluator is ready to render its own result column once at
// least two variants are picked and the golden-field requirement is satisfied
// (see isGoldenFieldSatisfied). Legacy pairwise configs qualify too — they
// normalize to exactly two variants, though a folded config keeps both
// variantA/variantB positions even when one is unset (see fromPairwise in
// normalizeComparison.ts), so an under-filled legacy config can still have
// variants.length === 2 with one entry "" — filter empty slots, not just
// array length. Exported so it can be unit-tested directly instead of only
// through a full table render.
export const isComparisonConfigured = (e: EvaluatorConfig) => {
  const comparison = toComparisonConfig(e);
  return (
    !!comparison &&
    comparison.variants.filter(Boolean).length >= 2 &&
    isGoldenFieldSatisfied(comparison)
  );
};

/**
 * Per-row evaluator results for one target: every per-target evaluator's
 * verdict, plus — for a column-target comparison (target.type === "evaluator"
 * with an embedded comparison config) — the target's own row keyed by its own
 * id, since the target IS the evaluator for this row-shaping purpose. Reads
 * `toComparisonConfig(target)` rather than the raw `target.pairwise` field:
 * normalizeTargets rewrites `pairwise` to `comparison` at load, so a check
 * against the raw legacy field is always false post-normalization and would
 * silently drop every column-target comparison's row data. Exported so it can
 * be unit-tested directly instead of only through a full table render.
 */
export const buildTargetEvaluatorsForRow = (
  target: TargetConfig,
  evaluators: EvaluatorConfig[],
  results: EvaluationResults,
  rowIndex: number,
): Record<string, unknown> =>
  Object.fromEntries([
    ...evaluators.map(
      (evaluator) =>
        [
          evaluator.id,
          results.evaluatorResults[target.id]?.[evaluator.id]?.[rowIndex] ??
            null,
        ] as [string, unknown],
    ),
    ...(toComparisonConfig(target)
      ? [
          [
            target.id,
            results.evaluatorResults[target.id]?.[target.id]?.[rowIndex] ??
              null,
          ] as [string, unknown],
        ]
      : []),
  ]);

// ============================================================================
// Main Component
// ============================================================================

type EvaluationsV3TableProps = {
  isLoadingExperiment?: boolean;
  isLoadingDatasets?: boolean;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
};

export function EvaluationsV3Table({
  isLoadingExperiment = false,
  isLoadingDatasets = false,
  disableVirtualization = false,
}: EvaluationsV3TableProps) {
  const { openDrawer, closeDrawer, currentDrawer } = useDrawer();
  // Serializable drawer URL params (evaluatorType, evaluatorId, …). Read here so
  // the comparison-reload re-hydration effect can inspect the open drawer; the
  // stable key keeps that effect from re-running on unrelated renders.
  const drawerParams = useDrawerParams();
  const drawerParamsKey = JSON.stringify(drawerParams);
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();
  // Forking an agent target (and its workflow, when workflow-type) on duplicate.
  // Source: same project — the workbench duplicates within the current project,
  // so `sourceProjectId === projectId` (see #5879). The cross-project replicate
  // flow (CopyAgentDialog) uses the same mutation with different project ids.
  const copyAgent = api.agents.copy.useMutation();
  // `agents.copy` leaves the forked workflow unpublished — the replicate flow
  // wants to review before publishing, but the workbench duplicate needs a
  // runnable target immediately. Publish here, in the caller, per #5879.
  // (Router is `workflow` singular, matching the rest of the codebase —
  // see api/root.ts.)
  const publishWorkflow = api.workflow.publish.useMutation();
  // Best-effort rollback on post-copy failure: if publish or addTarget
  // throws after `agents.copy` has already created the forked Agent (and,
  // for workflow-type agents, the forked Workflow/Version), we delete the
  // orphaned Agent so it doesn't keep counting against the license
  // `agents` quota (`enforceLicenseLimit`) with no target referencing it.
  // `agents.delete` is soft-delete; the orphaned workflow rows (if any)
  // are out of scope here — they have no enforcement cost and are cleaned
  // up separately by the existing workflow GC.
  const deleteAgent = api.agents.delete.useMutation();

  // Sync saved dataset changes to DB
  useDatasetSync();

  const {
    datasets,
    activeDatasetId,
    evaluators,
    targets,
    results,
    ui,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    deleteSelectedRows,
    getRowCount,
    addDataset,
    setActiveDataset,
    updateDataset,
    setColumnWidths,
    toggleColumnVisibility,
    addTarget,
    updateTarget,
    updateTargetComparison,
    removeTarget,
    setTargetMapping,
    removeTargetMapping,
    addEvaluator,
    experimentId,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      targets: state.targets,
      // Hydration signal for the comparison-reload effect: loadState sets this
      // atomically with targets/datasets, so a truthy value means getState() is
      // safe to read.
      experimentId: state.experimentId,
      results: state.results,
      // Only subscribe to specific UI properties we need (not the entire ui object)
      ui: {
        selectedRows: state.ui.selectedRows,
        editingCell: state.ui.editingCell,
        selectedCell: state.ui.selectedCell,
        columnWidths: state.ui.columnWidths,
        hiddenColumns: state.ui.hiddenColumns,
        rowHeightMode: state.ui.rowHeightMode,
      },
      // Actions (stable references)
      setSelectedCell: state.setSelectedCell,
      setEditingCell: state.setEditingCell,
      toggleRowSelection: state.toggleRowSelection,
      selectAllRows: state.selectAllRows,
      clearRowSelection: state.clearRowSelection,
      deleteSelectedRows: state.deleteSelectedRows,
      getRowCount: state.getRowCount,
      addDataset: state.addDataset,
      setActiveDataset: state.setActiveDataset,
      updateDataset: state.updateDataset,
      setColumnWidths: state.setColumnWidths,
      toggleColumnVisibility: state.toggleColumnVisibility,
      addTarget: state.addTarget,
      updateTarget: state.updateTarget,
      updateTargetComparison: state.updateTargetComparison,
      removeTarget: state.removeTarget,
      setTargetMapping: state.setTargetMapping,
      removeTargetMapping: state.removeTargetMapping,
      addEvaluator: state.addEvaluator,
    })),
  );

  // Load saved datasets when selected from drawer
  const { loadSavedDataset } = useDatasetSelectionLoader({
    projectId: project?.id,
    addDataset,
    setActiveDataset,
  });

  // Execution hook for running evaluations
  const {
    execute,
    abort,
    status,
    isAborting,
    rerunEvaluator,
    runEvaluatorOnAllRows,
  } = useExecuteEvaluation();

  // Execution handlers for partial execution
  const handleRunTarget = useCallback(
    (targetId: string) => {
      void execute({ type: "target", targetId });
    },
    [execute],
  );

  const handleRunRow = useCallback(
    (rowIndex: number) => {
      void execute({ type: "rows", rowIndices: [rowIndex] });
    },
    [execute],
  );

  const handleRunCell = useCallback(
    (rowIndex: number, targetId: string) => {
      void execute({ type: "cell", rowIndex, targetId });
    },
    [execute],
  );

  // Handler for re-running a single evaluator
  const handleRerunEvaluator = useCallback(
    (rowIndex: number, targetId: string, evaluatorId: string) => {
      void rerunEvaluator(rowIndex, targetId, evaluatorId);
    },
    [rerunEvaluator],
  );

  // Handler for running an evaluator on all rows with target outputs
  const handleRunEvaluatorOnAllRows = useCallback(
    (targetId: string, evaluatorId: string) => {
      void runEvaluatorOnAllRows(targetId, evaluatorId);
    },
    [runEvaluatorOnAllRows],
  );

  // Check if any row has a target output for a given target
  const hasAnyTargetOutputs = useCallback(
    (targetId: string): boolean => {
      const outputs = results.targetOutputs[targetId];
      if (!outputs) return false;
      return outputs.some((output) => output !== undefined && output !== null);
    },
    [results.targetOutputs],
  );

  // Handler for stopping execution
  const handleStopExecution = useCallback(() => {
    void abort();
  }, [abort]);

  // Check if execution is running
  const isExecutionRunning =
    status === "running" || results.status === "running";

  // Get the active dataset
  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId),
    [datasets, activeDatasetId],
  );

  // State for AddOrEditDatasetDrawer (for Save as dataset)
  const [saveAsDatasetDrawerOpen, setSaveAsDatasetDrawerOpen] = useState(false);
  const [datasetToSave, setDatasetToSave] = useState<
    | {
        name: string;
        columnTypes: { name: string; type: DatasetColumnType }[];
        datasetRecords: Array<{ id?: string } & Record<string, string>>;
      }
    | undefined
  >(undefined);

  // State for editing dataset columns
  const [editDatasetDrawerOpen, setEditDatasetDrawerOpen] = useState(false);

  // Hook for opening target editor with proper flow callbacks
  const { openTargetEditor, buildAvailableSources, isDatasetSource } =
    useOpenTargetEditor();

  // Hook for opening the grading-evaluator mapping drawer. Used to guide the
  // user to unmapped fields right after adding an evaluator (see Issue A).
  const openEvaluatorEditor = useOpenEvaluatorEditor();

  // Track pending mappings for new prompts (before they become targets)
  const pendingMappingsRef = useRef<Record<string, UIFieldMapping>>({});

  // Track variant selections made inside the creation evaluatorEditor so
  // handleSelectEvaluatorAsTarget can apply them on save instead of empty
  // defaults. Also acts as the signal that lifts `isComparison` to true in
  // EvaluatorEditorShared: when the ref-setter is wired via
  // createEvaluatorEditorCallbacks, the schema-driven `include_metrics`
  // renderer is suppressed and the inline MetricsSection (with working cost +
  // duration toggles) renders instead.
  const pendingComparisonRef = useRef<ComparisonEvaluatorConfig | null>(null);

  // Track target being switched (null when adding new, target ID when switching)
  const switchingTargetIdRef = useRef<string | null>(null);

  // Wrapper that handles both add and replace (for switch functionality)
  const addOrReplaceTarget = useCallback(
    (targetConfig: TargetConfig) => {
      if (switchingTargetIdRef.current) {
        // Switch mode: remove old target first, then add new one
        removeTarget(switchingTargetIdRef.current);
        switchingTargetIdRef.current = null;
      }
      addTarget(targetConfig);
    },
    [addTarget, removeTarget],
  );

  // Handler for when a saved agent is selected from the drawer
  const handleSelectSavedAgent = useCallback(
    (savedAgent: TypedAgent) => {
      const config = savedAgent.config as Record<string, unknown>;

      // Check if this is an HTTP agent by looking at savedAgent.type or config structure
      const isHttpAgent =
        savedAgent.type === "http" ||
        (config.url !== undefined && config.bodyTemplate !== undefined);

      // Convert TypedAgent to TargetConfig format (agent type)
      // For HTTP agents, extract inputs from bodyTemplate and store httpConfig
      // For code/workflow agents, use config.inputs directly
      let targetInputs: Field[];
      let httpConfig: TargetConfig["httpConfig"];

      if (isHttpAgent) {
        // HTTP agent: extract inputs from body template
        const httpComponentConfig = config as HttpComponentConfig;
        targetInputs = buildInputsFromBodyTemplate(
          httpComponentConfig.bodyTemplate,
        );
        httpConfig = convertHttpComponentConfig(httpComponentConfig);

        // Fall back to default input if bodyTemplate has no variables
        if (targetInputs.length === 0) {
          targetInputs = [{ identifier: "input", type: "str" }];
        }
      } else {
        // Code/workflow agent: use config.inputs directly
        targetInputs = (config.inputs as TargetConfig["inputs"]) ?? [
          { identifier: "input", type: "str" },
        ];
      }

      const targetConfig: TargetConfig = {
        id: `target_${Date.now()}`, // Generate unique ID for the workbench
        type: "agent", // This is a target of type "agent" (code/workflow/http)
        agentType: isHttpAgent
          ? "http"
          : (savedAgent.type as TargetConfig["agentType"]),
        dbAgentId: savedAgent.id, // Reference to the database agent
        inputs: targetInputs,
        outputs: (config.outputs as TargetConfig["outputs"]) ?? [
          { identifier: "output", type: "str" },
        ],
        mappings: {},
        httpConfig, // Only set for HTTP agents
      };
      addOrReplaceTarget(targetConfig);
      closeDrawer();
    },
    [addOrReplaceTarget, closeDrawer],
  );

  // Handler for when an evaluator is selected as a target from the drawer
  // Uses pre-computed fields from the API (includes type and optional flag)
  const handleSelectEvaluatorAsTarget = useCallback(
    (evaluator: EvaluatorWithFields) => {
      // Convert EvaluatorField[] to Field[] for TargetConfig
      const inputs: Field[] = evaluator.fields.map((field) => ({
        identifier: field.identifier,
        type: field.type as Field["type"],
        ...(field.optional && { optional: true }),
      }));

      // Use pre-computed output fields from the API
      // For workflow evaluators, these come from the End node inputs
      // For built-in evaluators, these are the standard passed/score/label/details
      const outputs: Field[] = evaluator.outputFields.map((field) => ({
        identifier: field.identifier,
        type: field.type as Field["type"],
      }));

      // Comparison column-target: seed an empty comparison config so the column
      // owns its variants/goldenField selections — this is the discriminator
      // the Run flow and validation use to render the clean
      // ComparisonConfigForm instead of the generic per-row mappings UI. Only
      // set when the underlying evaluator is a comparison judge, so every other
      // evaluator-as-target keeps its current behavior.
      const config = (evaluator.config ?? null) as {
        evaluatorType?: string;
        settings?: { has_golden_answer?: boolean };
      } | null;
      const isComparisonJudge =
        config?.evaluatorType === COMPARISON_EVALUATOR_TYPE ||
        config?.evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;

      // An existing comparison evaluator's saved `has_golden_answer` setting
      // is the source of truth for whether it needs a golden answer at all.
      // Hardcoding a fixed value here regardless of what was actually saved
      // left a "no golden answer" evaluator seeded with the wrong value: the
      // column target got `hasGoldenAnswer: true, goldenField: ""`, which
      // `isGoldenFieldSatisfied` reads as unsatisfied, silently skipping the
      // column at execution (#5528). Only fall back to `false` when the
      // evaluator has no saved setting at all (a genuinely new/
      // never-configured comparison) — Golden field defaults to "None", same
      // as `select_best_compare`'s own `has_golden_answer` schema default.
      const savedHasGoldenAnswer = config?.settings?.has_golden_answer;
      const comparison = pendingComparisonRef.current ?? {
        variants: [],
        hasGoldenAnswer: savedHasGoldenAnswer ?? false,
        goldenField: "",
        includeMetrics: [],
        randomizeOrder: true,
      };

      const targetConfig: TargetConfig = {
        id: `target_${Date.now()}`,
        type: "evaluator",
        targetEvaluatorId: evaluator.id,
        inputs,
        outputs,
        mappings: {},
        ...(isComparisonJudge && { comparison }),
      };
      pendingComparisonRef.current = null;
      addOrReplaceTarget(targetConfig);

      // A comparison needs two variants before it can judge anything. Picking
      // one straight off the evaluator list leaves it unconfigured, so open the
      // ComparisonConfigForm rather than dropping the user back on a column
      // that cannot run. The Comparison card collects the variants up front, so
      // that flow arrives here already configured and the drawer just closes.
      const needsConfiguration = comparison.variants.length < 2;
      if (isComparisonJudge && needsConfiguration) {
        // openTargetEditor reads fresh store state, so the target we just added
        // is visible when the drawer opens.
        void openTargetEditor(targetConfig);
      } else {
        closeDrawer();
      }
    },
    [addOrReplaceTarget, closeDrawer, openTargetEditor],
  );

  // Handler for when a prompt is selected from the drawer
  // Adds the target and immediately opens the prompt editor for configuration
  const handleSelectPrompt = useCallback(
    (prompt: {
      id: string;
      name: string;
      version?: number;
      versionId?: string;
      inputs?: Array<{ identifier: string; type: string }>;
      outputs?: PromptOutputField[];
    }) => {
      // Convert prompt to TargetConfig format (prompt type)
      // Use the actual inputs/outputs from the prompt data (already fetched in PromptListDrawer)
      const targetId = `target_${Date.now()}`;
      const targetConfig: TargetConfig = {
        id: targetId,
        type: "prompt",
        promptId: prompt.id,
        promptVersionId: prompt.versionId,
        promptVersionNumber: prompt.version,
        inputs: (prompt.inputs ?? [{ identifier: "input", type: "str" }]).map(
          (i) => ({
            identifier: i.identifier,
            type: i.type as Field["type"],
          }),
        ),
        outputs: toTargetOutputFields(
          prompt.outputs ?? [{ identifier: "output", type: "str" }],
        ),
        mappings: {},
      };
      // addOrReplaceTarget will auto-map based on the real inputs (and handle switch mode)
      addOrReplaceTarget(targetConfig);

      // Set up flow callbacks for the prompt editor using the centralized helper
      // This ensures we never forget a required callback
      setFlowCallbacks(
        "promptEditor",
        createPromptEditorCallbacks({
          targetId,
          updateTarget,
          setTargetMapping,
          removeTargetMapping,
          getActiveDatasetId: () =>
            useEvaluationsV3Store.getState().activeDatasetId,
          getDatasets: () => useEvaluationsV3Store.getState().datasets,
        }),
      );

      // Open the prompt editor drawer for the newly added target
      // Reset stack to prevent back button when switching between targets
      openDrawer(
        "promptEditor",
        {
          promptId: prompt.id,
          urlParams: { targetId },
        },
        { resetStack: true },
      );

      // Scroll to position the target column next to the drawer
      // Use requestAnimationFrame to ensure the drawer has started opening
      requestAnimationFrame(() => {
        scrollToTargetColumn(targetId);
      });
    },
    [
      addOrReplaceTarget,
      openDrawer,
      updateTarget,
      setTargetMapping,
      removeTargetMapping,
    ],
  );

  /**
   * Helper to add an evaluator to the workbench from an EvaluatorWithFields.
   * Used by both onSelect (existing evaluator) and onSave (newly created evaluator).
   * Fields are pre-computed by the API including type and optional flag.
   *
   * Returns the new workbench config id, or null when the evaluator was already
   * present (so callers can skip the post-add auto-open).
   */
  const addEvaluatorToWorkbench = useCallback(
    (evaluator: EvaluatorWithFields): string | null => {
      // Extract evaluator config from the Prisma evaluator
      const config = evaluator.config as EvaluatorDbConfig | null;

      // Check if this evaluator is already added globally
      const existingEvaluator = evaluators.find(
        (e) => e.dbEvaluatorId === evaluator.id,
      );

      // If already exists, reuse it instead of silently no-op'ing. The
      // pre-existing behavior (return null) made the drawer close with no
      // visible feedback, which trained users to fall back to "New Evaluator"
      // and pile up duplicate rows in the DB (Rogerio dogfood report — the
      // "why do I have 3 Pairwise Compare evaluators" thread). Returning the
      // existing config's id lets `guideOrCloseAfterAdd` route to the editor
      // just like a fresh add would, so the click has an observable effect.
      if (existingEvaluator) {
        return existingEvaluator.id;
      }

      // Create a new EvaluatorConfig from the evaluator
      // Note: settings are NOT stored in workbench state - always fetched fresh from DB
      const evaluatorConfig: EvaluatorConfig = {
        id: `evaluator_${Date.now()}`,
        evaluatorType: (config?.evaluatorType ??
          "custom/unknown") as EvaluatorConfig["evaluatorType"],
        inputs: evaluator.fields.map((field) => ({
          identifier: field.identifier,
          type: field.type as Field["type"],
          ...(field.optional && { optional: true }),
        })),
        mappings: {},
        dbEvaluatorId: evaluator.id,
      };

      // Add the evaluator globally (applies to all targets automatically).
      // The store runs auto-inference on add, so any auto-mappable fields are
      // already mapped by the time we read it back below.
      addEvaluator(evaluatorConfig);
      return evaluatorConfig.id;
    },
    [evaluators, addEvaluator],
  );

  /**
   * After adding an evaluator, decide whether to close the picker or guide the
   * user to its mapping drawer. Auto-inference cannot always satisfy every
   * required input (e.g. the dataset has no column for a required field), so
   * silently closing would leave a freshly added evaluator with no signpost to
   * where the missing mapping lives. When fields remain unmapped we open the
   * evaluator's mapping drawer instead (see Issue A).
   */
  const guideOrCloseAfterAdd = useCallback(
    (addedId: string | null, isCodeEvaluator: boolean) => {
      // Read fresh state: the just-added config (with inferred mappings) is not
      // yet reflected in this closure's `evaluators`.
      const state = useEvaluationsV3Store.getState();
      const added = state.evaluators.find((e) => e.id === addedId);
      // The first target provides the mapping context for the drawer.
      const firstTarget = state.targets[0];

      if (!addedId || !added) {
        closeDrawer();
        return;
      }

      if (
        firstTarget &&
        evaluatorHasMissingMappings(
          added,
          state.activeDatasetId,
          firstTarget.id,
        )
      ) {
        openEvaluatorEditor({
          evaluator: added,
          target: firstTarget,
          targetName:
            resolveTargetNameFromCache({
              target: firstTarget,
              utils: trpcUtils,
              projectId: project?.id,
            }) ?? "",
          isCodeEvaluator,
        });
        return;
      }
      closeDrawer();
    },
    [openEvaluatorEditor, closeDrawer, trpcUtils, project?.id],
  );

  // Handler for opening the evaluator selector (evaluators apply to ALL targets)
  const handleAddEvaluator = useCallback(() => {
    // Set up flow callback to handle evaluator selection (existing evaluator)
    // Note: EvaluatorListDrawer does NOT navigate after onSelect - caller must handle it
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator) => {
        const addedId = addEvaluatorToWorkbench(evaluator);
        guideOrCloseAfterAdd(addedId, evaluator.type === "code");
      },
    });

    // Set up flow callback to handle newly created evaluator
    // When user creates a new evaluator via the editor drawer, we need to:
    // 1. Fetch the newly created evaluator from DB
    // 2. Add it to the workbench
    // 3. Either close the drawer, or open its mapping drawer if fields are unmapped
    setFlowCallbacks(
      "evaluatorEditor",
      createEvaluatorEditorCallbacks({
        onSave: async (savedEvaluator: { id: string; name: string }) => {
          // Fetch the full evaluator data from DB
          const evaluator = await trpcUtils.evaluators.getById.fetch({
            id: savedEvaluator.id,
            projectId: project?.id ?? "",
          });

          if (evaluator) {
            const addedId = addEvaluatorToWorkbench(evaluator);
            guideOrCloseAfterAdd(addedId, evaluator.type === "code");
          } else {
            closeDrawer();
          }
          return true; // Indicate navigation was handled to prevent default back behavior
        },
      }),
    );

    openDrawer("evaluatorList");
  }, [
    openDrawer,
    closeDrawer,
    addEvaluatorToWorkbench,
    guideOrCloseAfterAdd,
    trpcUtils.evaluators.getById,
    project?.id,
  ]);

  // Handler for removing a target from the workbench
  const handleRemoveTarget = useCallback(
    (targetId: string) => {
      removeTarget(targetId);
    },
    [removeTarget],
  );

  // Handler for duplicating a target. Prompt/evaluator targets spread only
  // (they carry their own per-column draft). Agent targets fork the underlying
  // Agent row via `agents.copy` so the duplicate is independently editable —
  // and for workflow-type agents, the copied workflow is published immediately
  // so the duplicate runs without a "no committed version" error (see #5879).
  // On fork failure we log and skip adding the column rather than silently
  // falling back to a shallow copy, which would reintroduce the original bug
  // (two columns pointing at the same dbAgentId).
  //
  // The ordered `agents.copy → workflow.publish → addTarget` sequence and
  // the best-effort `agents.delete` rollback on post-copy failure live in
  // `utils/executeForkAgentDuplicate.ts` so they can be exercised by an
  // integration test with mocked mutations (see #5935 P2 review).
  const handleDuplicateTarget = useCallback(
    async (target: TargetConfig) => {
      // The component only renders inside a project-scoped route, so `project`
      // is set by the time the user can click Duplicate. Bail silently if not —
      // there is no project to fork into.
      const projectId = project?.id;
      if (!projectId) return;

      await executeForkAgentDuplicate({
        target,
        deps: {
          copyAgent,
          publishWorkflow,
          deleteAgent,
          addTarget,
          openTargetEditor,
          projectId,
        },
      });
    },
    [
      addTarget,
      openTargetEditor,
      copyAgent,
      publishWorkflow,
      deleteAgent,
      project?.id,
    ],
  );

  // Extracted so BOTH the Add→Comparison flow and the reload re-hydration
  // effect register the exact same evaluatorEditor callbacks. onSave fetches the
  // freshly-created evaluator and adds it as a target column; onComparisonChange
  // mirrors the live draft into pendingComparisonRef (also lifts `isComparison`
  // to true in EvaluatorEditorShared so ComparisonConfigForm renders).
  const handleComparisonEvaluatorSave = useCallback(
    async (savedEvaluator: { id: string; name: string }) => {
      const evaluator = await trpcUtils.evaluators.getById.fetch({
        id: savedEvaluator.id,
        projectId: project?.id ?? "",
      });
      if (!evaluator) {
        closeDrawer();
        return true;
      }
      handleSelectEvaluatorAsTarget(evaluator);
      return true;
    },
    [
      trpcUtils.evaluators.getById,
      project?.id,
      closeDrawer,
      handleSelectEvaluatorAsTarget,
    ],
  );
  const handlePendingComparisonChange = useCallback(
    (next: ComparisonEvaluatorConfig) => {
      pendingComparisonRef.current = next;
    },
    [],
  );

  // Handler for opening the add target flow (prompts/agents)
  // Memoized to prevent TargetSuperHeader re-renders
  const handleAddTarget = useCallback(() => {
    // Clear any pending mappings from previous flows
    pendingMappingsRef.current = {};
    // Note: Don't clear switchingTargetIdRef here - it's set by handleSwitchTarget before calling this

    // Build available sources for variable mapping (for new prompts)
    const availableSources = buildAvailableSources();

    // Handler to open promptEditor for new prompts with proper props
    const openNewPromptEditor = () => {
      openDrawer(
        "promptEditor",
        {
          // Pass available sources via complexProps
          availableSources,
          inputMappings: {},
          onInputMappingsChange: (
            identifier: string,
            mapping: UIFieldMapping | undefined,
          ) => {
            if (mapping) {
              pendingMappingsRef.current[identifier] = mapping;
            } else {
              delete pendingMappingsRef.current[identifier];
            }
          },
        },
        // Reset stack to prevent back button when creating new prompts
        { resetStack: true },
      );
    };

    // Set flow callbacks for the entire add-target flow
    setFlowCallbacks("promptList", {
      onSelect: handleSelectPrompt,
      // Custom onCreateNew to open promptEditor with availableSources
      onCreateNew: openNewPromptEditor,
    });
    setFlowCallbacks("promptEditor", {
      // For new prompts: track mappings in pendingMappingsRef, then apply when saved
      onInputMappingsChange: (
        identifier: string,
        mapping: UIFieldMapping | undefined,
      ) => {
        if (mapping) {
          pendingMappingsRef.current[identifier] = mapping;
        } else {
          delete pendingMappingsRef.current[identifier];
        }
      },
      onSave: (savedPrompt) => {
        // Apply pending mappings when creating the target
        const storeMappings: Record<string, FieldMapping> = {};
        for (const [key, uiMapping] of Object.entries(
          pendingMappingsRef.current,
        )) {
          storeMappings[key] = convertFromUIMapping(uiMapping, isDatasetSource);
        }

        // Get current state for active dataset
        const currentActiveDatasetId =
          useEvaluationsV3Store.getState().activeDatasetId;

        // Create target with pending mappings
        const targetId = `target_${Date.now()}`;
        const targetConfig: TargetConfig = {
          id: targetId,
          type: "prompt",
          promptId: savedPrompt.id,
          promptVersionId: savedPrompt.versionId,
          promptVersionNumber: savedPrompt.version,
          inputs: (
            savedPrompt.inputs ?? [{ identifier: "input", type: "str" }]
          ).map((i) => ({
            identifier: i.identifier,
            type: i.type as Field["type"],
          })),
          outputs: toTargetOutputFields(
            savedPrompt.outputs ?? [{ identifier: "output", type: "str" }],
          ),
          mappings:
            Object.keys(storeMappings).length > 0
              ? { [currentActiveDatasetId]: storeMappings }
              : {},
        };
        addOrReplaceTarget(targetConfig);

        // Clear pending mappings
        pendingMappingsRef.current = {};
      },
    });
    setFlowCallbacks("agentList", {
      onSelect: handleSelectSavedAgent,
    });
    setFlowCallbacks("agentCodeEditor", {
      onSave: handleSelectSavedAgent,
    });
    setFlowCallbacks("agentHttpEditor", {
      onSave: handleSelectSavedAgent,
    });
    setFlowCallbacks("workflowSelector", {
      onSave: handleSelectSavedAgent,
    });
    setFlowCallbacks("evaluatorList", {
      onSelect: handleSelectEvaluatorAsTarget,
    });
    // Build comparisonContext so the Comparison flow can pass it to
    // evaluatorEditor — this makes the creation form show the variant picker
    // and Golden field immediately, matching the edit-mode experience (#5195).
    //
    // No initialComparison: "New Comparison" means a blank one. Reaching an
    // existing comparison is the list's job now (TargetTypeSelectorDrawer opens
    // EvaluatorListDrawer filtered to comparison evaluators), and editing the
    // one already on the table is the column header's job. Pre-filling from the
    // first comparison in the workbench used to make a second one impossible to
    // create and quietly turned "add" into "edit".
    pendingComparisonRef.current = null;
    const state = useEvaluationsV3Store.getState();
    const variantOptions = state.targets.filter((t) => t.type !== "evaluator");
    const activeDs = state.datasets.find((d) => d.id === state.activeDatasetId);
    const datasetColumns =
      activeDs?.columns.map((c) => ({ id: c.id, name: c.name })) ?? [];
    const comparisonContext = {
      targets: variantOptions,
      datasetColumns,
      datasetName: activeDs?.name,
    };

    // Set up flow callback for when a NEW evaluator is created during the target flow
    // This handles: add comparison > evaluator > create new > category > fill form > create
    // Same callbacks the reload re-hydration effect below registers — extracted
    // to stable useCallbacks so both paths wire identical behavior.
    setFlowCallbacks(
      "evaluatorEditor",
      createEvaluatorEditorCallbacks({
        onSave: handleComparisonEvaluatorSave,
        onComparisonChange: handlePendingComparisonChange,
      }),
    );
    openDrawer("targetTypeSelector", { comparisonContext });
  }, [
    buildAvailableSources,
    openDrawer,
    handleSelectPrompt,
    handleSelectSavedAgent,
    handleSelectEvaluatorAsTarget,
    isDatasetSource,
    handleComparisonEvaluatorSave,
    handlePendingComparisonChange,
  ]);

  // Re-hydrate the comparison editor's flow context after a full page reload.
  // The URL reopens the evaluatorEditor drawer, but its comparisonContext
  // (complexProps) and flow callbacks are ephemeral module state wiped by the
  // reload — so ComparisonConfigForm's `isComparison && comparisonContext &&
  // onComparisonChange` guard fails and only the generic Name/Model/Prompt
  // editor shows. Rebuild them from the workbench store and re-attach reactively
  // via setFlowCallbacks + setComplexProps. Only setComplexProps notifies
  // CurrentDrawer to re-render (setFlowCallbacks deliberately does not, see
  // its own comment) — calling it second means that one re-render re-reads
  // both getters together (no URL change, no flushSync, no flicker).
  // Loop-safe: setting the callback flips the guard below, so a re-run
  // bails; the effect's deps don't change from these calls, so it fires once.
  useEffect(() => {
    if (currentDrawer !== "evaluatorEditor") return;
    const evaluatorType = drawerParams.evaluatorType;
    const isComparisonType =
      evaluatorType === COMPARISON_EVALUATOR_TYPE ||
      evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
    if (!isComparisonType) return;
    // Wait for the workbench store to finish hydrating (loadState sets
    // experimentId atomically with targets/datasets); reading getState() before
    // then would snapshot an empty picker and lock it in (the guard below blocks
    // a later refresh).
    if (!experimentId) return;
    // Flow context already present → a live Add/edit flow (or an earlier run of
    // this effect) wired it up. Also the loop guard.
    const alreadyWired = (
      getFlowCallbacks("evaluatorEditor") as
        | { onComparisonChange?: unknown }
        | undefined
    )?.onComparisonChange;
    if (alreadyWired) return;

    const state = useEvaluationsV3Store.getState();
    const variantOptions = state.targets.filter((t) => t.type !== "evaluator");
    const activeDs = state.datasets.find((d) => d.id === state.activeDatasetId);
    const datasetColumns =
      activeDs?.columns.map((c) => ({ id: c.id, name: c.name })) ?? [];
    // Edit reload carries the DB evaluator id → re-derive its saved comparison
    // config (matching the column-header edit flow). A fresh "New Comparison"
    // (no evaluatorId) leaves initialComparison undefined — a blank form, since
    // its unsaved in-progress draft was never persisted.
    const evaluatorId = drawerParams.evaluatorId;
    const evaluatorMatch = evaluatorId
      ? state.evaluators.find((e) => e.dbEvaluatorId === evaluatorId)
      : undefined;
    const targetMatch = evaluatorId
      ? state.targets.find((t) => t.targetEvaluatorId === evaluatorId)
      : undefined;
    const initialComparison = evaluatorMatch
      ? toComparisonConfig(evaluatorMatch)
      : targetMatch
        ? toComparisonConfig(targetMatch)
        : undefined;
    const comparisonContext = {
      ...(initialComparison ? { initialComparison } : {}),
      targets: variantOptions,
      datasetColumns,
      datasetName: activeDs?.name,
    };

    // targetMatch means this reload resumed editing an EXISTING comparison
    // column, not the New Comparison add flow. Wire the same target-bound
    // callbacks openTargetEditor uses (targetId + updateTarget +
    // updateTargetComparison) so a save updates that target in place. Without
    // this branch, onSave fell through to handleComparisonEvaluatorSave —
    // built for the add flow — which always creates a fresh target via
    // handleSelectEvaluatorAsTarget, duplicating the column on every
    // reload-then-save.
    setFlowCallbacks(
      "evaluatorEditor",
      targetMatch
        ? createEvaluatorEditorCallbacks({
            targetId: targetMatch.id,
            updateTarget,
            onComparisonChange: (next) => {
              updateTargetComparison(targetMatch.id, next);
            },
          })
        : createEvaluatorEditorCallbacks({
            onSave: handleComparisonEvaluatorSave,
            onComparisonChange: handlePendingComparisonChange,
          }),
    );
    setComplexProps({ comparisonContext });
    // drawerParams read through the stable drawerParamsKey signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentDrawer,
    drawerParamsKey,
    experimentId,
    handleComparisonEvaluatorSave,
    handlePendingComparisonChange,
    updateTarget,
    updateTargetComparison,
  ]);

  // Handler for switching a target (replace with another prompt/agent/evaluator)
  // Opens the specific drawer based on target type
  const handleSwitchTarget = useCallback(
    (target: TargetConfig) => {
      // Store the target ID being switched - will be removed when new target is added
      switchingTargetIdRef.current = target.id;

      // Set up flow callbacks (same as handleAddTarget but we open specific drawer)
      setFlowCallbacks("promptList", {
        onSelect: handleSelectPrompt,
      });
      setFlowCallbacks("agentList", {
        onSelect: handleSelectSavedAgent,
      });
      setFlowCallbacks("evaluatorList", {
        onSelect: handleSelectEvaluatorAsTarget,
      });

      // Open the specific drawer based on target type
      if (target.type === "prompt") {
        openDrawer("promptList");
      } else if (target.type === "agent") {
        openDrawer("agentList");
      } else if (target.type === "evaluator") {
        openDrawer("evaluatorList");
      }
    },
    [
      openDrawer,
      handleSelectPrompt,
      handleSelectSavedAgent,
      handleSelectEvaluatorAsTarget,
    ],
  );

  // Dataset handlers for drawer integration
  const datasetHandlers = useMemo(
    () => ({
      onSelectExisting: () => {
        openDrawer("selectDataset", {
          onSelect: (dataset: {
            datasetId: string;
            name: string;
            columnTypes: { name: string; type: DatasetColumnType }[];
          }) => {
            // Trigger loading of saved dataset records
            loadSavedDataset({
              datasetId: dataset.datasetId,
              name: dataset.name,
              columnTypes: dataset.columnTypes,
            });
          },
        });
      },
      onUploadCSV: () => {
        openDrawer("uploadCSV", {
          onSuccess: (params: {
            datasetId: string;
            name: string;
            columnTypes: { name: string; type: DatasetColumnType }[];
          }) => {
            // Trigger loading of uploaded dataset records
            loadSavedDataset({
              datasetId: params.datasetId,
              name: params.name,
              columnTypes: params.columnTypes,
            });
          },
        });
      },
      onEditDataset: () => {
        setEditDatasetDrawerOpen(true);
      },
      onSaveAsDataset: async (dataset: DatasetReference) => {
        if (dataset.type !== "inline" || !dataset.inline) return;
        if (!project?.id) return;

        // Convert inline dataset to row-based format, filtering empty rows
        const columns = dataset.inline.columns;
        const datasetRecords = convertInlineToRowRecords(
          columns,
          dataset.inline.records,
        );

        // Find next available name to avoid conflicts
        // E.g., if "Test Data" exists, suggest "Test Data (2)"
        let suggestedName = dataset.name;
        try {
          suggestedName = await trpcUtils.dataset.findNextName.fetch({
            projectId: project.id,
            proposedName: dataset.name,
          });
        } catch (error) {
          // If fetch fails, use original name - validation will catch conflicts
          console.warn("Failed to fetch next available name:", error);
        }

        setDatasetToSave({
          name: suggestedName,
          columnTypes: columns.map((col) => ({
            name: col.name,
            type: col.type as DatasetColumnType,
          })),
          datasetRecords,
        });
        setSaveAsDatasetDrawerOpen(true);
      },
    }),
    [openDrawer, loadSavedDataset, project?.id, trpcUtils],
  );

  // Create a map of evaluator IDs to evaluator configs for quick lookup
  const evaluatorsMap = useMemo(
    () => new Map(evaluators.map((e) => [e.id, e])),
    [evaluators],
  );

  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(
    null,
  );

  // Find the scroll container (parent with overflow: auto)
  useEffect(() => {
    if (!tableRef.current) return;

    let parent = tableRef.current.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.overflow === "auto" || style.overflowY === "auto") {
        setScrollContainer(parent);
        break;
      }
      parent = parent.parentElement;
    }
  }, []);

  // Clear cell selection when clicking outside the table rows
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Only clear if there's a selected cell
      if (!ui.selectedCell) return;

      // Check if click was inside the actual table element (rows)
      if (tableRef.current?.contains(e.target as Node)) return;

      // Clear the selection
      setSelectedCell(undefined);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ui.selectedCell, setSelectedCell]);

  const rowCount = getRowCount(activeDatasetId);
  // Always show at least 3 rows, and always include 1 extra empty row at the end (Excel-like behavior)
  const displayRowCount = Math.max(rowCount + 1, 3);

  // Determine if we should use virtualization
  // - Always use virtualization in compact mode (fixed 160px rows)
  // - Disable virtualization in expanded mode for datasets <= 100 rows
  const rowHeightMode = ui.rowHeightMode;
  const shouldVirtualize =
    rowHeightMode === "compact" || rowCount > MAX_ROWS_FOR_FIT_MODE;

  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

  // Handler for running selected rows
  const handleRunSelectedRows = useCallback(() => {
    const rowIndices = Array.from(selectedRows);
    if (rowIndices.length > 0) {
      void execute({ type: "rows", rowIndices });
    }
  }, [execute, selectedRows]);

  // Get columns from active dataset, filtering out hidden columns
  const allDatasetColumns = activeDataset?.columns ?? [];
  const datasetColumns = useMemo(
    () => allDatasetColumns.filter((col) => !ui.hiddenColumns.has(col.name)),
    [allDatasetColumns, ui.hiddenColumns],
  );

  // Keyboard navigation hook - handles arrow keys, Tab, Enter, Escape
  useTableKeyboardNavigation({
    datasetColumns,
    targets,
    displayRowCount,
    editingCell: ui.editingCell,
    selectedCell: ui.selectedCell,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  });

  // Get getCellValue from store
  const { getCellValue } = useEvaluationsV3Store((state) => ({
    getCellValue: state.getCellValue,
  }));

  // Which target column's header cell should glow — set by clicking a
  // variant name in a pairwise verdict (customer feedback, 2026-07-08).
  // Applied to the whole `<th>` box, not just the component rendered
  // inside it, so the highlight reads as "this column" rather than a
  // border around one label.
  const highlightedVariantTargetId = useEvaluationsV3Store(
    (state) => state.ui.highlightedVariantTargetId,
  );
  const highlightedVariantOutcome = useEvaluationsV3Store(
    (state) => state.ui.highlightedVariantOutcome,
  );

  // Build row data from active dataset records (works for both inline and saved)
  // Note: We include activeDataset in dependencies to ensure re-render when cell values change
  const rowData = useMemo((): TableRowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => {
      // Build dataset values for this row
      const datasetValues = Object.fromEntries(
        datasetColumns.map((col) => [
          col.id,
          getCellValue(activeDatasetId, index, col.id),
        ]),
      );

      // Empty rows (the Excel-style trailing phantom row) don't get executed
      // and shouldn't render target outputs / evaluator chips.
      const rowIsEmpty = isRowEmpty(datasetValues);

      return {
        rowIndex: index,
        dataset: datasetValues,
        isEmpty: rowIsEmpty,
        targets: Object.fromEntries(
          targets.map((target) => [
            target.id,
            {
              output: results.targetOutputs[target.id]?.[index] ?? null,
              // All evaluators apply to all targets
              evaluators: buildTargetEvaluatorsForRow(
                target,
                evaluators,
                results,
                index,
              ),
              // Error for this target/row
              error: results.errors[target.id]?.[index] ?? null,
              // Loading if this specific cell is in the executing set AND has no output/error yet
              // Once target output or error arrives, show it instead of skeleton
              isLoading:
                results.executingCells !== undefined &&
                isCellInExecution(results.executingCells, index, target.id) &&
                results.targetOutputs[target.id]?.[index] === undefined &&
                results.errors[target.id]?.[index] === undefined,
              // Trace ID for viewing the execution trace
              traceId:
                results.targetMetadata?.[target.id]?.[index]?.traceId ?? null,
              // Duration/latency for this cell execution
              duration:
                results.targetMetadata?.[target.id]?.[index]?.duration ?? null,
            },
          ]),
        ),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeDataset triggers re-render when data changes
  }, [
    activeDatasetId,
    activeDataset,
    datasetColumns,
    targets,
    evaluators,
    results,
    displayRowCount,
    getCellValue,
  ]);

  // Build columns - columnHelper is stable (useMemo to prevent recreating)
  const columnHelper = useMemo(() => createColumnHelper<TableRowData>(), []);

  // Extract target IDs for stable column structure.
  // Sort so non-evaluator targets (prompts/agents) always precede evaluator
  // targets (pairwise, custom evals) — giving the logical left-to-right order:
  // Target A | Target B | Pairwise.
  const targetIdsKey = targets
    .slice()
    .sort((a, b) => {
      if (a.type === "evaluator" && b.type !== "evaluator") return 1;
      if (a.type !== "evaluator" && b.type === "evaluator") return -1;
      return 0;
    })
    .map((r) => r.id)
    .join(",");
  const targetIds = useMemo(
    () =>
      targets
        .slice()
        .sort((a, b) => {
          if (a.type === "evaluator" && b.type !== "evaluator") return 1;
          if (a.type !== "evaluator" && b.type === "evaluator") return -1;
          return 0;
        })
        .map((r) => r.id),
    [targetIdsKey],
  );

  // Which target columns are comparisons, so they can be given a wider default.
  // Keyed on comparison-ness (not just the id list) so switching an evaluator
  // column to/from a comparison re-sizes it instead of keeping the old width.
  const comparisonTargetIdsKey = targets
    .filter((t) => t.type === "evaluator" && !!toComparisonConfig(t))
    .map((t) => t.id)
    .join(",");
  const comparisonTargetIds = useMemo(
    () => new Set(comparisonTargetIdsKey.split(",").filter(Boolean)),
    [comparisonTargetIdsKey],
  );

  // Similarly stabilize dataset columns - include type in key so icon updates when type changes
  const datasetColumnsKey = datasetColumns
    .map((c) => `${c.id}:${c.type}`)
    .join(",");
  const stableDatasetColumns = useMemo(
    () => datasetColumns,
    [datasetColumnsKey],
  );

  // Stabilize comparison evaluators — only those considered configured (see
  // isComparisonConfigured above). Key on the ordered variants list so the
  // column is only recreated when a variant is added, removed, or reordered.
  const comparisonEvaluatorsKey = evaluators
    .filter(isComparisonConfigured)
    .map((e) => `${e.id}:${toComparisonConfig(e)?.variants.join(",")}`)
    .join(";");
  const stableComparisonEvaluators = useMemo(
    () => evaluators.filter(isComparisonConfigured),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparisonEvaluatorsKey],
  );

  // Build table meta for passing dynamic data to headers/cells
  // This allows column definitions to stay stable while data changes
  const targetsMap = useMemo(
    () => new Map(targets.map((r) => [r.id, r])),
    [targets],
  );

  // Helper to check if a specific target has cells being executed
  const isTargetExecuting = useCallback(
    (targetId: string): boolean => {
      if (!results.executingCells) return false;
      // Check if any cell for this target is in the executing set
      for (let i = 0; i < rowCount; i++) {
        if (isCellInExecution(results.executingCells, i, targetId)) {
          return true;
        }
      }
      return false;
    },
    [results.executingCells, rowCount],
  );

  // Helper to check if a specific cell is being executed
  const isCellExecuting = useCallback(
    (rowIndex: number, targetId: string): boolean => {
      if (!results.executingCells) return false;
      return isCellInExecution(results.executingCells, rowIndex, targetId);
    },
    [results.executingCells],
  );

  // Helper to check if a specific evaluator is running
  const isEvaluatorRunning = useCallback(
    (rowIndex: number, targetId: string, evaluatorId: string): boolean => {
      if (!results.runningEvaluators) return false;
      return results.runningEvaluators.has(
        `${rowIndex}:${targetId}:${evaluatorId}`,
      );
    },
    [results.runningEvaluators],
  );

  const tableMeta: TableMeta = useMemo(
    () => ({
      // Target data
      targets,
      targetsMap,
      evaluatorsMap,
      openTargetEditor,
      handleDuplicateTarget,
      handleSwitchTarget,
      handleRemoveTarget,
      handleAddEvaluator,
      // Execution handlers
      handleRunTarget,
      handleRunRow,
      handleRunCell,
      handleRerunEvaluator,
      handleRunEvaluatorOnAllRows,
      handleStopExecution,
      isExecutionRunning,
      isTargetExecuting,
      isCellExecuting,
      isEvaluatorRunning,
      hasAnyTargetOutputs,
      // Selection data
      selectedRows,
      allSelected,
      someSelected,
      rowCount,
      toggleRowSelection,
      selectAllRows,
      clearRowSelection,
    }),
    [
      targets,
      targetsMap,
      evaluatorsMap,
      openTargetEditor,
      handleDuplicateTarget,
      handleSwitchTarget,
      handleRemoveTarget,
      handleAddEvaluator,
      handleRunTarget,
      handleRunRow,
      handleRunCell,
      handleRerunEvaluator,
      handleRunEvaluatorOnAllRows,
      handleStopExecution,
      isExecutionRunning,
      isTargetExecuting,
      isCellExecuting,
      isEvaluatorRunning,
      hasAnyTargetOutputs,
      selectedRows,
      allSelected,
      someSelected,
      rowCount,
      toggleRowSelection,
      selectAllRows,
      clearRowSelection,
    ],
  );

  const columns = useMemo(() => {
    const cols: ColumnDef<TableRowData>[] = [];

    // Checkbox column - reads from meta to keep column definition stable
    cols.push(
      columnHelper.display({
        id: "select",
        header: (context) => <CheckboxHeaderFromMeta context={context} />,
        cell: (info) => (
          <CheckboxCellFromMeta
            rowIndex={info.row.index}
            tableMeta={info.table.options.meta as TableMeta | undefined}
          />
        ),
        size: CHECKBOX_WIDTH_PX, // Checkbox uses fixed pixels
        enableResizing: false, // Checkbox column shouldn't be resizable
        meta: {
          columnType: "checkbox" as ColumnType,
          columnId: "__checkbox__",
          isFixedWidth: true, // Mark as fixed pixel width
        },
      }),
    );

    // Dataset columns from active dataset
    for (const column of stableDatasetColumns) {
      cols.push(
        columnHelper.accessor((row) => row.dataset[column.id], {
          id: `dataset.${column.id}`,
          header: () => (
            <HStack gap={1}>
              <ColumnTypeIcon type={column.type} />
              <Text fontSize="13px" fontWeight="medium">
                {column.name}
              </Text>
            </HStack>
          ),
          cell: (info) => info.getValue(),
          size: DATASET_COL_DEFAULT_PCT, // Percentage value
          minSize: 8, // Minimum 8%
          meta: {
            columnType: "dataset" as ColumnType,
            columnId: column.id,
            dataType: column.type,
          },
        }) as ColumnDef<TableRowData>,
      );
    }

    // Target columns - use IDs only for stable column structure
    // Headers/cells read current data from table meta
    for (const targetId of targetIds) {
      cols.push(
        columnHelper.accessor((row) => row.targets[targetId], {
          id: `target.${targetId}`,
          header: (context) => (
            <TargetHeaderFromMeta targetId={targetId} context={context} />
          ),
          cell: (info) => {
            // Phantom empty rows render nothing in target columns — the
            // dataset side keeps the click-to-add affordance, but there's
            // no input to run a target against.
            if (info.row.original.isEmpty) return null;
            const data = info.getValue() as {
              output: unknown;
              evaluators: Record<string, unknown>;
            };
            return (
              <TargetCellFromMeta
                targetId={targetId}
                data={data}
                rowIndex={info.row.index}
                tableMeta={info.table.options.meta as TableMeta | undefined}
              />
            );
          },
          size: comparisonTargetIds.has(targetId)
            ? COMPARISON_COL_DEFAULT_PCT
            : TARGET_COL_DEFAULT_PCT,
          minSize: comparisonTargetIds.has(targetId)
            ? COMPARISON_COL_MIN_PCT
            : 10,
          meta: {
            columnType: "target" as ColumnType,
            columnId: `target.${targetId}`,
          },
        }) as ColumnDef<TableRowData>,
      );
    }

    // Dedicated comparison result columns — one per fully-configured
    // comparison evaluator, rendered AFTER all target columns. The
    // orchestrator anchors Phase-2 results on the first variant's cell.
    for (const compEval of stableComparisonEvaluators) {
      const evaluatorId = compEval.id;
      const variantIds = toComparisonConfig(compEval)!.variants;
      const anchorVariantId = variantIds[0]!;
      cols.push(
        columnHelper.accessor(
          (row) => row.targets[anchorVariantId]?.evaluators[evaluatorId],
          {
            id: `comparison.${evaluatorId}`,
            header: (context) => {
              const meta = context.table.options.meta as TableMeta | undefined;
              const evaluator = meta?.evaluatorsMap.get(evaluatorId);
              return (
                <ComparisonColumnHeader
                  evaluatorId={evaluatorId}
                  name={evaluator?.localEvaluatorConfig?.name ?? "Comparison"}
                />
              );
            },
            cell: (info) => {
              if (info.row.original.isEmpty) return null;
              const meta = info.table.options.meta as TableMeta | undefined;
              const variantTargets = variantIds.map((id) =>
                meta?.targetsMap.get(id),
              );
              const rowData = info.row.original.targets[anchorVariantId];
              return (
                <ComparisonCell
                  result={info.getValue()}
                  isLoading={rowData?.isLoading}
                  variantTargets={variantTargets}
                />
              );
            },
            size: COMPARISON_COL_DEFAULT_PCT,
            minSize: COMPARISON_COL_MIN_PCT,
            meta: {
              columnType: "comparison" as ColumnType,
              columnId: `comparison.${evaluatorId}`,
            },
          },
        ) as ColumnDef<TableRowData>,
      );
    }

    return cols;
  }, [
    // ONLY structural dependencies - columns should almost never change
    // All dynamic data goes through tableMeta
    targetIds,
    comparisonTargetIds,
    stableDatasetColumns,
    stableComparisonEvaluators,
    columnHelper,
  ]);

  // Column sizing state - stores percentage values (e.g., 16 means 16%)
  // Initialize from store, which also stores percentages
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => ui.columnWidths,
  );

  // Track the table container width for converting pixel deltas to percentages
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );

  // Update container width on resize
  useEffect(() => {
    const handleResize = () => {
      if (tableRef.current?.parentElement) {
        setContainerWidth(tableRef.current.parentElement.clientWidth);
      } else {
        setContainerWidth(window.innerWidth);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Sync column sizing changes to store (debounced to avoid excessive updates)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track which column is being resized
  const resizingColumnRef = useRef<string | null>(null);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(0);

  // Single source of truth for a column's default/minimum width, by id and
  // type — every sizing path (drag start, drag clamp, double-click reset,
  // total-width sum, rendered width) reads through this instead of each
  // re-deriving "is this a comparison column" on its own, which is how the
  // comparison 24%/14% sizing previously only applied to rendering while the
  // other paths silently fell back to the ordinary target defaults.
  const getDefaultPctForColumn = useCallback(
    (columnId: string, columnType: string): number => {
      if (columnType === "dataset") return DATASET_COL_DEFAULT_PCT;
      if (columnType === "comparison") return COMPARISON_COL_DEFAULT_PCT;
      if (columnType === "target") {
        const targetId = columnId.replace(/^target\./, "");
        return comparisonTargetIds.has(targetId)
          ? COMPARISON_COL_DEFAULT_PCT
          : TARGET_COL_DEFAULT_PCT;
      }
      return TARGET_COL_DEFAULT_PCT;
    },
    [comparisonTargetIds],
  );

  const getMinPctForColumn = useCallback(
    (columnId: string, columnType: string): number => {
      if (columnType === "dataset") return 8;
      if (columnType === "comparison") return COMPARISON_COL_MIN_PCT;
      if (columnType === "target") {
        const targetId = columnId.replace(/^target\./, "");
        return comparisonTargetIds.has(targetId)
          ? COMPARISON_COL_MIN_PCT
          : 10;
      }
      return 10;
    },
    [comparisonTargetIds],
  );

  // Custom resize handler - converts pixel movements to percentage changes
  // This gives us fine-grained control over resize sensitivity
  const createResizeHandler = useCallback(
    (columnId: string, columnType: string) => {
      return (event: React.MouseEvent | React.TouchEvent) => {
        event.preventDefault();

        const startX =
          "touches" in event ? event.touches[0]!.clientX : event.clientX;

        // Get current width percentage
        const currentPct =
          columnSizing[columnId] ??
          getDefaultPctForColumn(columnId, columnType);

        resizingColumnRef.current = columnId;
        resizeStartXRef.current = startX;
        resizeStartWidthRef.current = currentPct;

        const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
          const currentX =
            "touches" in moveEvent
              ? moveEvent.touches[0]!.clientX
              : moveEvent.clientX;

          const deltaX = currentX - resizeStartXRef.current;

          // Convert pixel delta to percentage delta based on container width
          // This ensures consistent resize feel regardless of screen size
          const deltaPct = (deltaX / containerWidth) * 100;

          // Calculate new width percentage, clamped to this column's own
          // minimum rather than a flat 5% every column shared regardless of
          // its declared minSize.
          const newPct = Math.max(
            getMinPctForColumn(columnId, columnType),
            resizeStartWidthRef.current + deltaPct,
          );

          // Update column sizing state
          setColumnSizing((prev) => ({
            ...prev,
            [columnId]: newPct,
          }));
        };

        const handleEnd = () => {
          resizingColumnRef.current = null;

          // Sync to store after resize ends - use setState callback to get current value
          if (syncTimeoutRef.current) {
            clearTimeout(syncTimeoutRef.current);
          }
          syncTimeoutRef.current = setTimeout(() => {
            setColumnSizing((current) => {
              setColumnWidths(current);
              return current;
            });
          }, 100);

          document.removeEventListener("mousemove", handleMove);
          document.removeEventListener("mouseup", handleEnd);
          document.removeEventListener("touchmove", handleMove);
          document.removeEventListener("touchend", handleEnd);
        };

        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleEnd);
        document.addEventListener("touchmove", handleMove);
        document.addEventListener("touchend", handleEnd);
      };
    },
    [
      columnSizing,
      containerWidth,
      setColumnWidths,
      getDefaultPctForColumn,
      getMinPctForColumn,
    ],
  );

  // Check if a column is currently being resized
  const isColumnResizing = useCallback(
    (columnId: string) => resizingColumnRef.current === columnId,
    [],
  );

  // Double-click handler to reset column to default width
  const handleResizeDoubleClick = useCallback(
    (columnId: string, columnType: string) => {
      const defaultPct = getDefaultPctForColumn(columnId, columnType);

      setColumnSizing((prev) => ({
        ...prev,
        [columnId]: defaultPct,
      }));

      // Sync to store
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = setTimeout(() => {
        setColumnSizing((current) => {
          setColumnWidths(current);
          return current;
        });
      }, 100);
    },
    [setColumnWidths, getDefaultPctForColumn],
  );

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Disable TanStack's built-in resize - we use our own custom handler
    // for better control over percentage-based resizing
    enableColumnResizing: false,
    state: {
      columnSizing,
    },
    meta: tableMeta,
  });

  // Calculate colspan for super headers
  const datasetColSpan = 1 + datasetColumns.length;
  // +1 for the spacer column that's always present
  const targetsColSpan = targets.length + 2;

  // Measure the super header row's actual rendered height so the column
  // header row's sticky `top` offset matches. A hardcoded constant drifts
  // from the true <th> box-model height (content + padding + border) in a
  // border-collapse:separate table, leaving a gap through which body rows
  // bleed during vertical scroll.
  const superHeaderRowRef = useRef<HTMLTableRowElement>(null);
  const [superHeaderHeight, setSuperHeaderHeight] = useState(51);
  useLayoutEffect(() => {
    const row = superHeaderRowRef.current;
    if (!row) return;
    const measure = () => {
      setSuperHeaderHeight(row.getBoundingClientRect().height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const MENU_PLUS_PADDING = 56 + 16;

  // Calculate total percentage for all resizable columns
  // This allows the table to grow beyond 100% when needed
  const totalColumnPercentage = useMemo(() => {
    let total = 0;

    // Sum dataset column percentages. Column IDs here must match the
    // header IDs resize actually writes to (`dataset.${column.id}` /
    // `target.${targetId}`, see the columnHelper.accessor calls above) —
    // a mismatched ID means a resized column's stored width is never
    // found, so its contribution silently falls back to the default.
    for (const col of datasetColumns) {
      const colId = `dataset.${col.id}`;
      total += columnSizing[colId] ?? DATASET_COL_DEFAULT_PCT;
    }

    // Sum target column percentages
    for (const target of targets) {
      const colId = `target.${target.id}`;
      total += columnSizing[colId] ?? getDefaultPctForColumn(colId, "target");
    }

    // Sum dedicated comparison result column percentages — omitting these left
    // the table's overall width computed as if they didn't exist, so each
    // comparison column had to squeeze into whatever sliver of "auto" space
    // was left over, rendering near-zero-width with its text wrapping one
    // character per line.
    for (const compEval of stableComparisonEvaluators) {
      const colId = `comparison.${compEval.id}`;
      total += columnSizing[colId] ?? getDefaultPctForColumn(colId, "comparison");
    }

    return total;
  }, [
    datasetColumns,
    targets,
    stableComparisonEvaluators,
    columnSizing,
    getDefaultPctForColumn,
  ]);

  // Get column width as CSS string
  // Converts stored percentage values to CSS percentage strings
  const getColumnWidth = useCallback(
    (columnId: string, columnType: string, isFixedWidth?: boolean): string => {
      // Checkbox is always fixed pixels
      if (columnId === "select" || isFixedWidth) {
        return `${CHECKBOX_WIDTH_PX}px`;
      }

      // Get stored percentage or use default
      const storedPct = columnSizing[columnId];
      if (storedPct) {
        return `${storedPct}%`;
      }

      // Use default percentages based on column type. A comparison reaches
      // here as either a column-style TARGET ("target.<id>") or a dedicated
      // comparison column; both carry the extra verdict + metrics in their
      // header and need the wider share — getDefaultPctForColumn is the one
      // place that knows this, so every sizing path (this render, drag
      // start/clamp, double-click reset, total-width sum) agrees.
      if (
        columnType === "dataset" ||
        columnType === "target" ||
        columnType === "comparison"
      ) {
        return `${getDefaultPctForColumn(columnId, columnType)}%`;
      }
      return "auto";
    },
    [columnSizing, getDefaultPctForColumn],
  );

  return (
    <Box
      minWidth={`calc(100vw - ${MENU_PLUS_PADDING}px + ${DRAWER_WIDTH}px)`}
      minHeight="full"
      css={{
        ...datasetTableCss,
        "& table": {
          // Table width = max(100%, sum of column percentages) + fixed widths (checkbox + drawer)
          // This allows columns to exceed 100% and trigger horizontal scroll
          width: `calc(max(100%, ${totalColumnPercentage}%) + ${CHECKBOX_WIDTH_PX}px + ${DRAWER_WIDTH}px)`,
          minWidth: "100%",
          tableLayout: "fixed",
          borderCollapse: "separate",
          borderSpacing: "0",
        },
        // Super header row (first row in thead)
        "& thead tr:first-of-type th": {
          position: "sticky",
          top: 0,
          zIndex: 11,
          backgroundColor: "var(--chakra-colors-bg-panel)",
          // Promotes the sticky cell to its own GPU compositing layer.
          // Without it the browser can paint the sticky header a frame
          // behind the scrolling body during fast/inertial scroll (each
          // row's rich content — long generated text, evaluator chips —
          // costs real paint time), so body content flashes through the
          // header for a frame even though both are correctly positioned
          // once scrolling settles. Standard fix for this class of bug.
          willChange: "transform",
        },
        // Column header row (second row in thead)
        "& thead tr:nth-of-type(2) th": {
          position: "sticky",
          top: `${superHeaderHeight}px`,
          zIndex: 10,
          backgroundColor: "var(--chakra-colors-bg-panel)",
          willChange: "transform",
        },
        // Resize handle styles - wider hit area, narrow visible indicator
        "& .resizer": {
          position: "absolute",
          right: "-6px",
          top: 0,
          height: "100%",
          width: "12px",
          cursor: "col-resize",
          userSelect: "none",
          touchAction: "none",
          zIndex: 1,
          // Visible indicator is a pseudo-element
          "&::after": {
            content: '""',
            position: "absolute",
            right: "5px",
            top: 0,
            height: "100%",
            width: "4px",
            background: "var(--chakra-colors-blue-solid)",
            opacity: 0,
            transition: "opacity 0.15s",
          },
        },
        // Only show indicator when hovering the resize area or actively resizing
        "& .resizer:hover::after, & .resizer.isResizing::after": {
          opacity: 1,
        },
      }}
    >
      {/* Pairwise scoreboard moved into the column header — the top bar was
          redundant with the column's mini-summary. CSV export + filter chips
          will move into the column header's overflow menu in a follow-up. */}
      <table ref={tableRef}>
        {/* Define column widths with colgroup for table-layout: fixed */}
        <colgroup>
          {table.getAllColumns().map((column) => {
            const meta = column.columnDef.meta as
              | { columnType?: string; isFixedWidth?: boolean }
              | undefined;
            const columnType = meta?.columnType ?? "unknown";
            const isFixedWidth = meta?.isFixedWidth ?? false;
            return (
              <col
                key={column.id}
                style={{
                  width: getColumnWidth(column.id, columnType, isFixedWidth),
                  // Prevent checkbox column from growing beyond 40px
                  ...(isFixedWidth && { maxWidth: `${CHECKBOX_WIDTH_PX}px` }),
                }}
              />
            );
          })}
          {/* Filler column - absorbs remaining space when total % < 100% */}
          <col style={{ width: "auto" }} />
          {/* Spacer column for drawer */}
          <col style={{ width: DRAWER_WIDTH }} />
        </colgroup>
        <thead>
          <tr ref={superHeaderRowRef}>
            <DatasetSuperHeader
              colSpan={datasetColSpan}
              activeDataset={activeDataset}
              datasetHandlers={datasetHandlers}
              isLoading={isLoadingExperiment}
            />
            <TargetSuperHeader
              colSpan={targetsColSpan}
              onAddClick={handleAddTarget}
              showWarning={targets.length === 0}
              isLoading={isLoadingExperiment}
            />
          </tr>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                // Extract target ID if this is a target column
                const isTargetColumn = header.id.startsWith("target.");
                const targetId = isTargetColumn
                  ? header.id.replace("target.", "")
                  : undefined;
                const meta = header.column.columnDef.meta as
                  | { columnType?: string; isFixedWidth?: boolean }
                  | undefined;
                const columnType = meta?.columnType ?? "unknown";
                const isFixedWidth = meta?.isFixedWidth ?? false;

                const isHighlightedColumn =
                  !!targetId && targetId === highlightedVariantTargetId;
                // The winning column glows green so a verdict reads at a
                // glance; tracing a loser (or a tie) keeps the neutral blue.
                const highlightColor =
                  highlightedVariantOutcome === "won" ? "green" : "blue";

                return (
                  <th
                    key={header.id}
                    style={{
                      width: getColumnWidth(
                        header.id,
                        columnType,
                        isFixedWidth,
                      ),
                      // The highlight is a brief auto-clearing flash (see
                      // CLICK_HIGHLIGHT_DURATION_MS in ComparisonCell), so it
                      // needs to fade smoothly rather than snapping off.
                      // boxShadow always has a value (harmless — headers
                      // don't normally use one) so it has a "from" and "to"
                      // to interpolate. background is left unset when not
                      // highlighted rather than forced to "transparent" —
                      // this inline style would otherwise override the
                      // header's own opaque background (needed so scrolled
                      // rows don't show through the sticky header).
                      transition:
                        "box-shadow 300ms ease, background-color 300ms ease",
                      boxShadow: isHighlightedColumn
                        ? `inset 0 0 0 2px var(--chakra-colors-${highlightColor}-400)`
                        : "inset 0 0 0 0 transparent",
                      ...(isHighlightedColumn && {
                        background: `var(--chakra-colors-${highlightColor}-subtle)`,
                      }),
                    }}
                    // Add data attribute for target columns to enable scroll-to behavior
                    {...(targetId && { "data-target-column": targetId })}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {/* Resize handle - custom handler for percentage-based resizing */}
                    {/* Double-click resets to default width */}
                    {!isFixedWidth && header.id !== "select" && (
                      <div
                        onMouseDown={createResizeHandler(header.id, columnType)}
                        onTouchStart={createResizeHandler(
                          header.id,
                          columnType,
                        )}
                        onDoubleClick={() =>
                          handleResizeDoubleClick(header.id, columnType)
                        }
                        className={`resizer ${
                          isColumnResizing(header.id) ? "isResizing" : ""
                        }`}
                      />
                    )}
                  </th>
                );
              })}
              {targets.length === 0 ? (
                // Filler + Spacer combined when no targets
                <th
                  colSpan={2}
                  style={{
                    width: `calc(${DRAWER_WIDTH}px + ${TARGET_COL_DEFAULT_PCT}%)`,
                  }}
                >
                  <Link
                    fontSize="xs"
                    color="fg.subtle"
                    fontStyle="italic"
                    onClick={handleAddTarget}
                  >
                    Click "+ Add" above to get started
                  </Link>
                </th>
              ) : (
                <>
                  {/* Filler column - absorbs remaining space */}
                  <th
                    colSpan={2}
                    style={{ width: "auto", minWidth: DRAWER_WIDTH }}
                  ></th>
                </>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          <EvaluationsV3DatasetTableProvider>
            <VirtualizedTableBody
              rows={table.getRowModel().rows}
              scrollContainer={scrollContainer}
              columnCount={table.getAllColumns().length + 2}
              selectedRows={selectedRows}
              activeDatasetId={activeDatasetId}
              isLoading={isLoadingExperiment || isLoadingDatasets}
              shouldVirtualize={shouldVirtualize}
              disableVirtualization={disableVirtualization}
              displayRowCount={displayRowCount}
              trailingSpacerWidth={DRAWER_WIDTH}
            />
          </EvaluationsV3DatasetTableProvider>
        </tbody>
      </table>

      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={handleRunSelectedRows}
        onStop={handleStopExecution}
        onDelete={() => deleteSelectedRows(activeDatasetId)}
        onClear={clearRowSelection}
        isRunning={isExecutionRunning}
        isAborting={isAborting}
      />

      {/* Save as dataset drawer */}
      <AddOrEditDatasetDrawer
        datasetToSave={datasetToSave}
        open={saveAsDatasetDrawerOpen}
        onClose={() => {
          setSaveAsDatasetDrawerOpen(false);
          setDatasetToSave(undefined);
        }}
        onSuccess={(savedDataset) => {
          // Replace the inline dataset with a reference to the saved one
          const currentDataset = datasets.find((d) => d.id === activeDatasetId);
          if (currentDataset && currentDataset.type === "inline") {
            // Build columns with proper types
            const columns: DatasetColumn[] = savedDataset.columnTypes.map(
              (col, index) => ({
                id: `${col.name}_${index}`,
                name: col.name,
                type: col.type as DatasetColumnType,
              }),
            );
            // Use updateDataset to transform inline to saved in-place
            // This avoids the removeDataset + addDataset race condition
            // that caused duplicate datasets when removeDataset was blocked
            updateDataset(currentDataset.id, {
              type: "saved",
              name: savedDataset.name,
              datasetId: savedDataset.datasetId,
              inline: undefined,
              columns,
            });
          }
          setSaveAsDatasetDrawerOpen(false);
          setDatasetToSave(undefined);
        }}
      />

      {/* Edit dataset columns drawer */}
      <AddOrEditDatasetDrawer
        datasetToSave={
          activeDataset
            ? {
                datasetId:
                  activeDataset.type === "saved"
                    ? activeDataset.datasetId
                    : undefined,
                name: activeDataset.name,
                columnTypes: activeDataset.columns.map((col) => ({
                  name: col.name,
                  type: col.type,
                })),
                // For inline datasets, include records so column mapping works
                ...(activeDataset.type === "inline" && activeDataset.inline
                  ? {
                      datasetRecords: convertInlineToRowRecords(
                        activeDataset.inline.columns,
                        activeDataset.inline.records,
                      ),
                    }
                  : {}),
              }
            : undefined
        }
        open={editDatasetDrawerOpen}
        onClose={() => setEditDatasetDrawerOpen(false)}
        localOnly={activeDataset?.type === "inline"}
        columnVisibility={{
          hiddenColumns: ui.hiddenColumns,
          onToggleVisibility: toggleColumnVisibility,
        }}
        onSuccess={(updatedDataset) => {
          if (!activeDataset) return;

          // Build new columns from the drawer result
          const newColumns: DatasetColumn[] = updatedDataset.columnTypes.map(
            (col, index) => ({
              id: `${col.name}_${index}`,
              name: col.name,
              type: col.type as DatasetColumnType,
            }),
          );

          if (activeDataset.type === "inline") {
            // For inline datasets, update columns and map records
            const oldRecords = activeDataset.inline?.records ?? {};
            const newRecords: Record<string, string[]> = {};

            // Map old records to new columns (by name matching)
            const currentRowCount = getRowCount(activeDataset.id);
            for (const newCol of newColumns) {
              const oldCol = activeDataset.columns.find(
                (c) => c.name === newCol.name,
              );
              const oldValues = oldCol ? oldRecords[oldCol.id] : undefined;
              if (oldValues) {
                newRecords[newCol.id] = oldValues;
              } else {
                // New column, initialize with empty values
                newRecords[newCol.id] = Array(currentRowCount).fill("");
              }
            }

            updateDataset(activeDataset.id, {
              name: updatedDataset.name,
              columns: newColumns,
              inline: {
                columns: newColumns,
                records: newRecords,
              },
            });
          } else {
            // For saved datasets, just update our local reference
            // The drawer already saved to DB
            updateDataset(activeDataset.id, {
              name: updatedDataset.name,
              columns: newColumns,
              datasetId: updatedDataset.datasetId,
            });
          }

          setEditDatasetDrawerOpen(false);
        }}
      />
    </Box>
  );
}
