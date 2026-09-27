import { Box } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import {
  datasetTableCss,
  useTableKeyboardNavigation,
  VirtualizedTableBody,
} from "@langwatch/dataset-browser-kit";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { isRowEmpty, isCellInExecution, toComparisonConfig } from "@langwatch/experiment-contract";
import { createColumnHelper, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  AddOrEditDatasetDrawer,
  DatasetRecordSync,
} from "../../../behavior/experiments-v3/lent-dataset-capabilities.tsx";
import { useDatasetSyncProps } from "../../../behavior/experiments-v3/use-dataset-sync.ts";
import { useSyncPromptEditorMappings } from "../../../behavior/experiments-v3/use-evaluation-mappings.ts";
import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { useOpenTargetEditor } from "../../../behavior/experiments-v3/use-open-target-editor.ts";
import { useDatasetSelectionLoader } from "../../../behavior/experiments-v3/use-saved-dataset-loader.ts";
import { useSyncWorkflowTargetFields } from "../../../behavior/experiments-v3/use-sync-workflow-target-fields.ts";
import { useWorkbenchColumnSizing } from "../../../behavior/experiments-v3/use-workbench-column-sizing.ts";
import {
  type SaveAsDatasetDraft,
  useWorkbenchDatasetHandlers,
} from "../../../behavior/experiments-v3/use-workbench-dataset-handlers.ts";
import { useWorkbenchRunHandlers } from "../../../behavior/experiments-v3/use-workbench-run-handlers.ts";
import {
  useWorkbenchAddTargetFlow,
  useWorkbenchEvaluatorAdd,
  useWorkbenchTargetSelection,
} from "../../../behavior/experiments-v3/use-workbench-target-flow.ts";
import { DRAWER_WIDTH } from "../../../model/experiments-v3/constants.ts";
import type {
  EvaluationsV3State,
  EvaluationResults,
  EvaluatorConfig,
  TableMeta,
  TableRowData,
  TargetConfig,
} from "../../../model/experiments-v3/types.ts";
import { isGoldenFieldSatisfied } from "../../../model/experiments-v3/types.ts";
import { CHECKBOX_WIDTH_PX } from "../../../model/experiments-v3/workbench-column-widths.ts";
import {
  datasetEditDraft,
  editedDatasetUpdate,
  savedDatasetUpdate,
} from "../../../model/experiments-v3/workbench-dataset-edits.ts";
import { SelectionToolbar } from "../../elements/experiments-v3/selection-toolbar.tsx";
import { TargetSuperHeader } from "../../elements/experiments-v3/target-super-header.tsx";
import { DatasetSuperHeader } from "./dataset-super-header.tsx";
import { EvaluationsV3DatasetTableProvider } from "./evaluations-v3-dataset-table-provider.tsx";
import { workbenchColumns } from "./workbench-columns.tsx";
import {
  WorkbenchColGroup,
  WorkbenchHeaderCell,
  WorkbenchHeaderFiller,
} from "./workbench-table-head.tsx";

// Max rows for expanded mode (disable virtualization above this)
const MAX_ROWS_FOR_FIT_MODE = 100;

// A comparison evaluator is ready to render its own result column once at least two
// variants are picked and the golden-field requirement is satisfied (see
// isGoldenFieldSatisfied).
export const isComparisonConfigured = (e: EvaluatorConfig) => {
  const comparison = toComparisonConfig(e);
  return (
    !!comparison &&
    comparison.variants.filter(Boolean).length >= 2 &&
    isGoldenFieldSatisfied(comparison)
  );
};

/**
 * One target's cell in one row: its output, evaluator chips, error (the engine's
 * raw string plus the code its copy is read from), trace and duration. It shows a
 * skeleton while executing until its output or error arrives.
 */
const targetCellOf = ({
  target,
  evaluators,
  results,
  rowIndex,
}: {
  target: TargetConfig;
  evaluators: EvaluatorConfig[];
  results: EvaluationsV3State["results"];
  rowIndex: number;
}) => {
  const metadata = results.targetMetadata?.[target.id]?.[rowIndex];
  const output = results.targetOutputs[target.id]?.[rowIndex];
  const error = results.errors[target.id]?.[rowIndex];
  return {
    output: output ?? null,
    evaluators: buildTargetEvaluatorsForRow({ target, evaluators, results, rowIndex }),
    error: error ?? null,
    domainError: metadata?.domainError,
    isLoading:
      results.executingCells !== undefined &&
      isCellInExecution(results.executingCells, rowIndex, target.id) &&
      output === undefined &&
      error === undefined,
    traceId: metadata?.traceId ?? null,
    duration: metadata?.duration ?? null,
  };
};

/**
 * Per-row evaluator results for one target: every per-target evaluator's
 * verdict, plus — for a column-target comparison — the target's own row
 * keyed by its own id, since the target IS the evaluator for this shape.
 */
export const buildTargetEvaluatorsForRow = ({
  target,
  evaluators,
  results,
  rowIndex,
}: {
  target: TargetConfig;
  evaluators: EvaluatorConfig[];
  results: EvaluationResults;
  rowIndex: number;
}): Record<string, unknown> =>
  Object.fromEntries([
    ...evaluators.map(
      (evaluator) =>
        [evaluator.id, results.evaluatorResults[target.id]?.[evaluator.id]?.[rowIndex] ?? null] as [
          string,
          unknown,
        ],
    ),
    ...(toComparisonConfig(target)
      ? [
          [target.id, results.evaluatorResults[target.id]?.[target.id]?.[rowIndex] ?? null] as [
            string,
            unknown,
          ],
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
  /**
   * "Optimize this prompt": hand the column to Langy. The page owns the
   * hook (it is the Langy integration point); undefined hides the menu item.
   */
  onOptimizeTarget?: ({ target, name }: { target: TargetConfig; name: string }) => void;
};

/** Target ids with prompts and agents before evaluator targets: Target A | Target B | Pairwise. */
const orderedTargetIdsKey = (targets: TargetConfig[]): string =>
  [
    ...targets.filter((t) => t.type !== "evaluator"),
    ...targets.filter((t) => t.type === "evaluator"),
  ]
    .map((t) => t.id)
    .join(",");

/** The comparison targets, keyed on comparison-ness so a switch re-sizes the column. */
const comparisonTargetIdsKeyOf = (targets: TargetConfig[]): string =>
  targets
    .filter((t) => t.type === "evaluator" && !!toComparisonConfig(t))
    .map((t) => t.id)
    .join(",");

/** Configured comparisons keyed on their ordered variants: a column changes only with them. */
const comparisonEvaluatorsKeyOf = (evaluators: EvaluatorConfig[]): string =>
  evaluators
    .filter(isComparisonConfigured)
    .map((e) => `${e.id}:${toComparisonConfig(e)?.variants.join(",")}`)
    .join(";");

/** The element's ancestors that scroll (overflow auto), nearest first. */
const scrollableAncestorsOf = (element: HTMLElement | null): HTMLElement[] => {
  const ancestors: HTMLElement[] = [];
  for (let parent = element?.parentElement ?? null; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (style.overflow === "auto" || style.overflowY === "auto") ancestors.push(parent);
  }
  return ancestors;
};

/** The last value seen under `key`, so a new array with the same key keeps its identity. */
const useStableByKey = <T,>(key: string, value: T): T => {
  const [keyed, setKeyed] = useState({ key, value });
  if (keyed.key !== key) setKeyed({ key, value });
  return keyed.key === key ? keyed.value : value;
};

/** A mousedown outside the table clears the selected cell. */
const useClickOutsideClearsSelection = ({
  tableRef,
  hasSelection,
  clearSelection,
}: {
  tableRef: React.RefObject<HTMLTableElement | null>;
  hasSelection: boolean;
  clearSelection: () => void;
}) => {
  useEffect(() => {
    if (!hasSelection) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && tableRef.current?.contains(event.target)) return;
      clearSelection();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [hasSelection, clearSelection, tableRef]);
};

export function EvaluationsV3Table({
  isLoadingExperiment = false,
  isLoadingDatasets = false,
  disableVirtualization = false,
  onOptimizeTarget,
}: EvaluationsV3TableProps) {
  // Sync saved dataset changes to DB
  const datasetSyncProps = useDatasetSyncProps();

  // Re-read what each workflow agent target reads and produces from its
  // workflow, which owns those fields and can change without the workbench.
  useSyncWorkflowTargetFields();

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
    duplicateTarget,
    removeTarget,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      targets: state.targets,
      // Hydration signal for the comparison-reload effect: loadState sets this
      // atomically with targets/datasets, so a truthy value means getState() is
      // safe to read.
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
      duplicateTarget: state.duplicateTarget,
      removeTarget: state.removeTarget,
    })),
  );

  const { project } = useOrganizationTeamProject();
  // Load saved datasets when selected from drawer
  const { loadSavedDataset } = useDatasetSelectionLoader({
    projectId: project?.id,
    addDataset,
    setActiveDataset,
  });

  const {
    execute,
    isAborting,
    handleRunTarget,
    handleRunRow,
    handleRunCell,
    handleRerunEvaluator,
    handleRunEvaluatorOnAllRows,
    hasAnyTargetOutputs,
    handleStopExecution,
    isExecutionRunning,
  } = useWorkbenchRunHandlers(results);

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
        datasetRecords: ({ id?: string } & Record<string, string>)[];
      }
    | undefined
  >(undefined);

  // State for editing dataset columns
  const [editDatasetDrawerOpen, setEditDatasetDrawerOpen] = useState(false);

  // Hook for opening target editor with proper flow callbacks
  const { openTargetEditor } = useOpenTargetEditor();
  // The open prompt editor follows the active dataset through its drawer props.
  useSyncPromptEditorMappings();

  const selection = useWorkbenchTargetSelection();
  const { handleAddEvaluator } = useWorkbenchEvaluatorAdd();
  const { handleAddTarget, handleSwitchTarget } = useWorkbenchAddTargetFlow(selection);

  // Handler for removing a target from the workbench
  const handleRemoveTarget = useCallback(
    (targetId: string) => {
      removeTarget(targetId);
    },
    [removeTarget],
  );

  // Handler for duplicating a target
  const handleDuplicateTarget = useCallback(
    (target: TargetConfig) => {
      const duplicatedId = duplicateTarget({ targetId: target.id });
      if (!duplicatedId) return;
      // Read the copy back: the store wired it up (its own mappings plus every
      // evaluator's mappings for it), so this is not the target we passed in.
      const duplicated = useEvaluationsV3Store
        .getState()
        .targets.find((t) => t.id === duplicatedId);
      // Open the prompt editor for the duplicated target if it's a prompt
      if (duplicated?.type === "prompt") {
        void openTargetEditor(duplicated);
      }
    },
    [duplicateTarget, openTargetEditor],
  );

  const openEditDrawer = useCallback(() => setEditDatasetDrawerOpen(true), []);
  const openSaveAsDrawer = useCallback((draft: SaveAsDatasetDraft) => {
    setDatasetToSave(draft);
    setSaveAsDatasetDrawerOpen(true);
  }, []);
  const datasetHandlers = useWorkbenchDatasetHandlers({
    loadSavedDataset,
    openEditDrawer,
    openSaveAsDrawer,
  });

  // Create a map of evaluator IDs to evaluator configs for quick lookup
  const evaluatorsMap = useMemo(() => new Map(evaluators.map((e) => [e.id, e])), [evaluators]);

  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

  // Find the scroll container (parent with overflow: auto)
  useEffect(() => {
    const [scrollable] = scrollableAncestorsOf(tableRef.current);
    if (scrollable) setScrollContainer(scrollable);
  }, []);

  // Clear cell selection when clicking outside the table rows
  useClickOutsideClearsSelection({
    tableRef,
    hasSelection: !!ui.selectedCell,
    clearSelection: () => setSelectedCell(undefined),
  });

  const rowCount = getRowCount(activeDatasetId);
  // Always show at least 3 rows, plus 1 extra empty row at the end (Excel-like behavior)
  const displayRowCount = Math.max(rowCount + 1, 3);

  // Determine if we should use virtualization
  // - Always use virtualization in compact mode (fixed 160px rows)
  // - Disable virtualization in expanded mode for datasets <= 100 rows
  const rowHeightMode = ui.rowHeightMode;
  const shouldVirtualize = rowHeightMode === "compact" || rowCount > MAX_ROWS_FOR_FIT_MODE;

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
  const allDatasetColumns = useMemo(() => activeDataset?.columns ?? [], [activeDataset?.columns]);
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
        datasetColumns.map((col) => [col.id, getCellValue(activeDatasetId, index, col.id)]),
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
            targetCellOf({ target, evaluators, results, rowIndex: index }),
          ]),
        ),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeDataset re-renders on change
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
  const targetIdsKey = orderedTargetIdsKey(targets);
  const targetIds = useMemo(() => targetIdsKey.split(",").filter(Boolean), [targetIdsKey]);

  // Which target columns are comparisons, so they can be given a wider default.
  // Keyed on comparison-ness (not just the id list) so switching an evaluator
  // column to/from a comparison re-sizes it instead of keeping the old width.
  const comparisonTargetIdsKey = comparisonTargetIdsKeyOf(targets);
  const comparisonTargetIds = useMemo(
    () => new Set(comparisonTargetIdsKey.split(",").filter(Boolean)),
    [comparisonTargetIdsKey],
  );

  // Similarly stabilize dataset columns - include type in key so icon updates when type changes
  const datasetColumnsKey = datasetColumns.map((c) => `${c.id}:${c.type}`).join(",");
  const stableDatasetColumns = useStableByKey(datasetColumnsKey, datasetColumns);

  // Stabilize comparison evaluators — only those considered configured (see
  // isComparisonConfigured above). Key on the ordered variants list so the
  // column is only recreated when a variant is added, removed, or reordered.
  const comparisonEvaluatorsKey = comparisonEvaluatorsKeyOf(evaluators);
  const stableComparisonEvaluators = useMemo(
    () => evaluators.filter(isComparisonConfigured),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparisonEvaluatorsKey],
  );

  // Build table meta for passing dynamic data to headers/cells
  // This allows column definitions to stay stable while data changes
  const targetsMap = useMemo(() => new Map(targets.map((r) => [r.id, r])), [targets]);

  // Helper to check if a specific target has cells being executed
  const isTargetExecuting = useCallback(
    (targetId: string): boolean => {
      const executing = results.executingCells;
      if (!executing) return false;
      return Array.from({ length: rowCount }, (_, i) => i).some((i) =>
        isCellInExecution(executing, i, targetId),
      );
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
      return results.runningEvaluators.has(`${rowIndex}:${targetId}:${evaluatorId}`);
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
      handleOptimizeTarget: onOptimizeTarget,
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
      onOptimizeTarget,
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

  const columns = useMemo(
    () =>
      workbenchColumns({
        columnHelper,
        datasetColumns: stableDatasetColumns,
        targetIds,
        comparisonTargetIds,
        comparisonEvaluators: stableComparisonEvaluators,
      }),
    // Structural dependencies only: all dynamic data reaches cells through tableMeta.
    [
      targetIds,
      comparisonTargetIds,
      stableDatasetColumns,
      stableComparisonEvaluators,
      columnHelper,
    ],
  );

  // Column sizing state - stores percentage values (e.g., 16 means 16%)
  // Initialize from store, which also stores percentages
  const datasetColumnIds = useMemo(() => datasetColumns.map((c) => c.id), [datasetColumns]);
  const comparisonEvaluatorIds = useMemo(
    () => stableComparisonEvaluators.map((e) => e.id),
    [stableComparisonEvaluators],
  );
  const {
    columnSizing,
    createResizeHandler,
    isColumnResizing,
    handleResizeDoubleClick,
    totalColumnPercentage,
    getColumnWidth,
  } = useWorkbenchColumnSizing({
    initialWidths: ui.columnWidths,
    setColumnWidths,
    tableRef,
    comparisonTargetIds,
    datasetColumnIds,
    targetIds,
    comparisonEvaluatorIds,
  });

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
        <WorkbenchColGroup table={table} getColumnWidth={getColumnWidth} />
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
              {headerGroup.headers.map((header) => (
                <WorkbenchHeaderCell
                  key={header.id}
                  header={header}
                  highlightedTargetId={highlightedVariantTargetId}
                  highlightOutcome={highlightedVariantOutcome}
                  getColumnWidth={getColumnWidth}
                  createResizeHandler={createResizeHandler}
                  handleResizeDoubleClick={handleResizeDoubleClick}
                  isColumnResizing={isColumnResizing}
                />
              ))}
              <WorkbenchHeaderFiller hasTargets={targets.length > 0} onAddClick={handleAddTarget} />
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

      <DatasetRecordSync {...datasetSyncProps} />

      {/* Save as dataset drawer */}
      <AddOrEditDatasetDrawer
        datasetToSave={datasetToSave}
        open={saveAsDatasetDrawerOpen}
        onClose={() => {
          setSaveAsDatasetDrawerOpen(false);
          setDatasetToSave(undefined);
        }}
        onSuccess={(savedDataset) => {
          const currentDataset = datasets.find((d) => d.id === activeDatasetId);
          if (currentDataset?.type === "inline") {
            updateDataset(currentDataset.id, savedDatasetUpdate(savedDataset));
          }
          setSaveAsDatasetDrawerOpen(false);
          setDatasetToSave(undefined);
        }}
      />

      {/* Edit dataset columns drawer */}
      <AddOrEditDatasetDrawer
        datasetToSave={activeDataset ? datasetEditDraft(activeDataset) : undefined}
        open={editDatasetDrawerOpen}
        onClose={() => setEditDatasetDrawerOpen(false)}
        localOnly={activeDataset?.type === "inline"}
        columnVisibility={{
          hiddenColumns: ui.hiddenColumns,
          onToggleVisibility: toggleColumnVisibility,
        }}
        onSuccess={(updatedDataset) => {
          if (!activeDataset) return;
          updateDataset(
            activeDataset.id,
            editedDatasetUpdate({
              dataset: activeDataset,
              edited: updatedDataset,
              rowCount: getRowCount(activeDataset.id),
            }),
          );
          setEditDatasetDrawerOpen(false);
        }}
      />
    </Box>
  );
}
