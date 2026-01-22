import { Box, HStack, Text } from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import {
  type ColumnDef,
  type ColumnSizingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import { api } from "~/utils/api";

/**
 * Type for the config stored in DB Evaluator.config field.
 * The DB stores evaluatorType and settings - inputs are derived from
 * the evaluator definition at runtime, not stored in DB.
 */
type EvaluatorDbConfig = {
  evaluatorType?: EvaluatorTypes;
  settings?: Record<string, unknown>;
};

import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import type { Field } from "~/optimization_studio/types/dsl";
import type { DatasetColumnType } from "~/server/datasets/types";
import { useDatasetSync } from "../hooks/useDatasetSync";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useExecuteEvaluation } from "../hooks/useExecuteEvaluation";
import {
  scrollToTargetColumn,
  useOpenTargetEditor,
} from "../hooks/useOpenTargetEditor";
import { useDatasetSelectionLoader } from "../hooks/useSavedDatasetLoader";
import { useTableKeyboardNavigation } from "../hooks/useTableKeyboardNavigation";
import type {
  DatasetColumn,
  DatasetReference,
  EvaluatorConfig,
  FieldMapping,
  SavedRecord,
  TableMeta,
  TableRowData,
  TargetConfig,
} from "../types";
import { convertInlineToRowRecords } from "../utils/datasetConversion";
import { isRowEmpty } from "../utils/emptyRowDetection";
import { isCellInExecution } from "../utils/executionScope";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../utils/fieldMappingConverters";
import { createPromptEditorCallbacks } from "../utils/promptEditorCallbacks";
import { ColumnTypeIcon } from "./ColumnTypeIcon";
import { type ColumnType, TableCell } from "./DatasetSection/TableCell";
import { DatasetSuperHeader } from "./DatasetSuperHeader";
import { SelectionToolbar } from "./SelectionToolbar";
import {
  CheckboxCellFromMeta,
  CheckboxHeaderFromMeta,
  TargetCellFromMeta,
  TargetHeaderFromMeta,
} from "./TableMetaWrappers";
import { TargetSuperHeader } from "./TargetSuperHeader";

// Types are imported from ../types (TableRowData, TableMeta)
// Meta wrappers are imported from ./TableMetaWrappers

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
  const { openDrawer, closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();

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
    removeTarget,
    setTargetMapping,
    removeTargetMapping,
    addEvaluator,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      targets: state.targets,
      results: state.results,
      // Only subscribe to specific UI properties we need (not the entire ui object)
      ui: {
        selectedRows: state.ui.selectedRows,
        editingCell: state.ui.editingCell,
        selectedCell: state.ui.selectedCell,
        columnWidths: state.ui.columnWidths,
        hiddenColumns: state.ui.hiddenColumns,
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
  const { execute, abort, status, isAborting, rerunEvaluator } =
    useExecuteEvaluation();

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

  // Track pending mappings for new prompts (before they become targets)
  const pendingMappingsRef = useRef<Record<string, UIFieldMapping>>({});

  // Handler for when a saved agent is selected from the drawer
  const handleSelectSavedAgent = useCallback(
    (savedAgent: TypedAgent) => {
      const config = savedAgent.config as Record<string, unknown>;

      // Convert TypedAgent to TargetConfig format (agent type)
      // Agent type and workflow ID are fetched at runtime via dbAgentId when needed
      const targetConfig: TargetConfig = {
        id: `target_${Date.now()}`, // Generate unique ID for the workbench
        type: "agent", // This is a target of type "agent" (code/workflow)
        name: savedAgent.name,
        dbAgentId: savedAgent.id, // Reference to the database agent
        inputs: (config.inputs as TargetConfig["inputs"]) ?? [
          { identifier: "input", type: "str" },
        ],
        outputs: (config.outputs as TargetConfig["outputs"]) ?? [
          { identifier: "output", type: "str" },
        ],
        mappings: {},
      };
      addTarget(targetConfig);
      closeDrawer();
    },
    [addTarget, closeDrawer],
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
      outputs?: Array<{ identifier: string; type: string }>;
    }) => {
      // Convert prompt to TargetConfig format (prompt type)
      // Use the actual inputs/outputs from the prompt data (already fetched in PromptListDrawer)
      const targetId = `target_${Date.now()}`;
      const targetConfig: TargetConfig = {
        id: targetId,
        type: "prompt",
        name: prompt.name,
        promptId: prompt.id,
        promptVersionId: prompt.versionId,
        promptVersionNumber: prompt.version,
        inputs: (prompt.inputs ?? [{ identifier: "input", type: "str" }]).map(
          (i) => ({
            identifier: i.identifier,
            type: i.type as Field["type"],
          }),
        ),
        outputs: (
          prompt.outputs ?? [{ identifier: "output", type: "str" }]
        ).map((o) => ({
          identifier: o.identifier,
          type: o.type as Field["type"],
        })),
        mappings: {},
      };
      // addTarget will auto-map based on the real inputs
      addTarget(targetConfig);

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
      addTarget,
      openDrawer,
      updateTarget,
      setTargetMapping,
      removeTargetMapping,
    ],
  );

  /**
   * Helper to add an evaluator to the workbench from a Prisma Evaluator.
   * Used by both onSelect (existing evaluator) and onSave (newly created evaluator).
   */
  const addEvaluatorToWorkbench = useCallback(
    (evaluator: Evaluator) => {
      // Extract evaluator config from the Prisma evaluator
      const config = evaluator.config as EvaluatorDbConfig | null;

      // Check if this evaluator is already added globally
      const existingEvaluator = evaluators.find(
        (e) => e.dbEvaluatorId === evaluator.id,
      );

      // If already exists, no need to add again (it applies to all targets)
      if (existingEvaluator) {
        return;
      }

      // Get the evaluator definition to derive inputs from requiredFields/optionalFields
      const evaluatorType = config?.evaluatorType;
      const evaluatorDef = evaluatorType
        ? AVAILABLE_EVALUATORS[evaluatorType]
        : undefined;

      // Derive inputs from evaluator definition's required and optional fields
      const inputFields = [
        ...(evaluatorDef?.requiredFields ?? []),
        ...(evaluatorDef?.optionalFields ?? []),
      ];

      // Create a new EvaluatorConfig from the Prisma evaluator
      // Note: settings are NOT stored in workbench state - always fetched fresh from DB
      const evaluatorConfig: EvaluatorConfig = {
        id: `evaluator_${Date.now()}`,
        evaluatorType: (config?.evaluatorType ??
          "custom/unknown") as EvaluatorConfig["evaluatorType"],
        name: evaluator.name,
        inputs: inputFields.map((field) => ({
          identifier: field,
          type: "str" as const, // Default all evaluator inputs to string
        })),
        mappings: {},
        dbEvaluatorId: evaluator.id,
      };

      // Add the evaluator globally (applies to all targets automatically)
      addEvaluator(evaluatorConfig);
    },
    [evaluators, addEvaluator],
  );

  // Handler for opening the evaluator selector (evaluators apply to ALL targets)
  const handleAddEvaluator = useCallback(() => {
    // Set up flow callback to handle evaluator selection (existing evaluator)
    // Note: EvaluatorListDrawer does NOT navigate after onSelect - caller must handle it
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator) => {
        addEvaluatorToWorkbench(evaluator);
        closeDrawer(); // Close drawer after adding evaluator to workbench
      },
    });

    // Set up flow callback to handle newly created evaluator
    // When user creates a new evaluator via the editor drawer, we need to:
    // 1. Fetch the newly created evaluator from DB
    // 2. Add it to the workbench
    // 3. Close the drawer
    setFlowCallbacks("evaluatorEditor", {
      onSave: async (savedEvaluator: { id: string; name: string }) => {
        // Fetch the full evaluator data from DB
        const evaluator = await trpcUtils.evaluators.getById.fetch({
          id: savedEvaluator.id,
          projectId: project?.id ?? "",
        });

        if (evaluator) {
          addEvaluatorToWorkbench(evaluator);
        }
        closeDrawer(); // Close drawer after adding evaluator to workbench
      },
    });

    openDrawer("evaluatorList");
  }, [
    openDrawer,
    closeDrawer,
    addEvaluatorToWorkbench,
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

  // Handler for duplicating a target
  const handleDuplicateTarget = useCallback(
    (target: TargetConfig) => {
      const newTarget: TargetConfig = {
        ...target,
        id: `target-${nanoid(8)}`,
      };
      addTarget(newTarget);
    },
    [addTarget],
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

  // Estimated row height for virtualization
  const ROW_HEIGHT = 60;

  // Stable callbacks for virtualizer to prevent infinite re-renders
  const getScrollElement = useCallback(
    () => scrollContainer,
    [scrollContainer],
  );
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  // Set up row virtualization with dynamic measurement
  const rowVirtualizer = useVirtualizer({
    count: displayRowCount,
    getScrollElement,
    estimateSize,
    overscan: 5, // Render 5 extra rows above/below viewport for smooth scrolling
    enabled: !!scrollContainer, // Only enable when scroll container is available
    // Enable dynamic measurement - measures actual row heights as they render
    measureElement:
      typeof window !== "undefined"
        ? (element) => element?.getBoundingClientRect().height ?? ROW_HEIGHT
        : undefined,
  });

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

      // Check if this row is empty - empty rows don't get executed
      const _rowIsEmpty = isRowEmpty(datasetValues);

      return {
        rowIndex: index,
        dataset: datasetValues,
        targets: Object.fromEntries(
          targets.map((target) => [
            target.id,
            {
              output: results.targetOutputs[target.id]?.[index] ?? null,
              // All evaluators apply to all targets
              evaluators: Object.fromEntries(
                evaluators.map((evaluator) => [
                  evaluator.id,
                  results.evaluatorResults[target.id]?.[evaluator.id]?.[
                    index
                  ] ?? null,
                ]),
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

  // Extract target IDs for stable column structure
  // Only recreate when the actual IDs change, not when target data changes
  const targetIdsKey = targets.map((r) => r.id).join(",");
  const targetIds = useMemo(() => targets.map((r) => r.id), [targetIdsKey]);

  // Similarly stabilize dataset column IDs
  const datasetColumnIdsKey = datasetColumns.map((c) => c.id).join(",");
  const stableDatasetColumns = useMemo(
    () => datasetColumns,
    [datasetColumnIdsKey],
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
      handleRemoveTarget,
      handleAddEvaluator,
      // Execution handlers
      handleRunTarget,
      handleRunRow,
      handleRunCell,
      handleRerunEvaluator,
      handleStopExecution,
      isExecutionRunning,
      isTargetExecuting,
      isCellExecuting,
      isEvaluatorRunning,
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
      handleRemoveTarget,
      handleAddEvaluator,
      handleRunTarget,
      handleRunRow,
      handleRunCell,
      handleRerunEvaluator,
      handleStopExecution,
      isExecutionRunning,
      isTargetExecuting,
      isCellExecuting,
      isEvaluatorRunning,
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
        size: 40,
        meta: {
          columnType: "checkbox" as ColumnType,
          columnId: "__checkbox__",
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
          size: 200,
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
          size: 280,
          minSize: 200,
          meta: {
            columnType: "target" as ColumnType,
            columnId: `target.${targetId}`,
          },
        }) as ColumnDef<TableRowData>,
      );
    }

    return cols;
  }, [
    // ONLY structural dependencies - columns should almost never change
    // All dynamic data goes through tableMeta
    targetIds,
    stableDatasetColumns,
    columnHelper,
  ]);

  // Column sizing state - initialize from store
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => ui.columnWidths,
  );

  // Sync column sizing changes to store (debounced to avoid excessive updates)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleColumnSizingChange = useCallback(
    (
      updater:
        | ColumnSizingState
        | ((prev: ColumnSizingState) => ColumnSizingState),
    ) => {
      setColumnSizing((prev) => {
        const newSizing =
          typeof updater === "function" ? updater(prev) : updater;
        // Debounce sync to store
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
        }
        syncTimeoutRef.current = setTimeout(() => {
          setColumnWidths(newSizing);
        }, 100);
        return newSizing;
      });
    },
    [setColumnWidths],
  );

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    state: {
      columnSizing,
    },
    onColumnSizingChange: handleColumnSizingChange,
    meta: tableMeta,
  });

  // Calculate colspan for super headers
  const datasetColSpan = 1 + datasetColumns.length;
  // +1 for the spacer column that's always present
  const targetsColSpan = targets.length + 1;

  // Height of the super header row (Dataset/Agents row)
  const SUPER_HEADER_HEIGHT = 51;
  const DRAWER_WIDTH = 456;
  const MENU_PLUS_PADDING = 56 + 16;

  return (
    <Box
      minWidth={`calc(100vw - ${MENU_PLUS_PADDING}px + ${DRAWER_WIDTH}px)`}
      minHeight="full"
      css={{
        "& table": {
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: "0",
        },
        // Super header row (first row in thead)
        "& thead tr:first-of-type th": {
          position: "sticky",
          top: 0,
          zIndex: 11,
          backgroundColor: "var(--chakra-colors-bg-panel)",
        },
        // Column header row (second row in thead)
        "& thead tr:nth-of-type(2) th": {
          position: "sticky",
          top: `${SUPER_HEADER_HEIGHT}px`,
          zIndex: 10,
          backgroundColor: "var(--chakra-colors-bg-panel)",
        },
        "& th": {
          borderBottom: "1px solid var(--chakra-colors-border)",
          borderRight: "1px solid var(--chakra-colors-border-muted)",
          padding: "8px 12px",
          textAlign: "left",
          backgroundColor: "var(--chakra-colors-bg-panel)",
          fontWeight: "medium",
          fontSize: "13px",
          position: "relative",
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
        "& td": {
          borderBottom: "1px solid var(--chakra-colors-border-muted)",
          borderRight: "1px solid var(--chakra-colors-border-muted)",
          padding: "8px 12px",
          fontSize: "13px",
          verticalAlign: "top",
          // CSS variable for fade overlay gradient
          "--cell-bg": "var(--chakra-colors-bg-panel)",
        },
        "& tr:hover td": {
          backgroundColor: "var(--chakra-colors-bg-subtle)",
          // Update CSS variable for fade overlay on hover
          "--cell-bg": "var(--chakra-colors-bg-subtle)",
        },
        // Selected row styling
        "& tr[data-selected='true'] td": {
          backgroundColor: "var(--chakra-colors-blue-subtle)",
          "--cell-bg": "var(--chakra-colors-blue-subtle)",
          "border-color": "var(--chakra-colors-blue-muted)",
        },
        "& tr:has(+ tr[data-selected='true']) td": {
          "border-bottom-color": "var(--chakra-colors-blue-muted)",
        },
      }}
    >
      <table ref={tableRef}>
        <thead>
          <tr>
            <DatasetSuperHeader
              colSpan={datasetColSpan}
              activeDataset={activeDataset}
              datasetHandlers={datasetHandlers}
              isLoading={isLoadingExperiment}
            />
            <TargetSuperHeader
              colSpan={targetsColSpan}
              onAddClick={() => {
                // Clear any pending mappings from previous flows
                pendingMappingsRef.current = {};

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
                      storeMappings[key] = convertFromUIMapping(
                        uiMapping,
                        isDatasetSource,
                      );
                    }

                    // Get current state for active dataset
                    const currentActiveDatasetId =
                      useEvaluationsV3Store.getState().activeDatasetId;

                    // Create target with pending mappings
                    const targetId = `target_${Date.now()}`;
                    const targetConfig: TargetConfig = {
                      id: targetId,
                      type: "prompt",
                      name: savedPrompt.name,
                      promptId: savedPrompt.id,
                      promptVersionId: savedPrompt.versionId,
                      promptVersionNumber: savedPrompt.version,
                      inputs: (
                        savedPrompt.inputs ?? [
                          { identifier: "input", type: "str" },
                        ]
                      ).map((i) => ({
                        identifier: i.identifier,
                        type: i.type as Field["type"],
                      })),
                      outputs: (
                        savedPrompt.outputs ?? [
                          { identifier: "output", type: "str" },
                        ]
                      ).map((o) => ({
                        identifier: o.identifier,
                        type: o.type as Field["type"],
                      })),
                      mappings:
                        Object.keys(storeMappings).length > 0
                          ? { [currentActiveDatasetId]: storeMappings }
                          : {},
                    };
                    addTarget(targetConfig);

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
                setFlowCallbacks("workflowSelector", {
                  onSave: handleSelectSavedAgent,
                });
                openDrawer("targetTypeSelector");
              }}
              showWarning={targets.length === 0}
              hasComparison={targets.length > 0}
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

                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    // Add data attribute for target columns to enable scroll-to behavior
                    {...(targetId && { "data-target-column": targetId })}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {/* Resize handle */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`resizer ${
                          header.column.getIsResizing() ? "isResizing" : ""
                        }`}
                      />
                    )}
                  </th>
                );
              })}
              {targets.length === 0 ? (
                // Spacer column to match drawer width + default target column width
                <th
                  style={{
                    width: DRAWER_WIDTH + 280,
                    minWidth: DRAWER_WIDTH + 280,
                  }}
                >
                  <Text fontSize="xs" color="fg.subtle" fontStyle="italic">
                    Click "+ Add" above to get started
                  </Text>
                </th>
              ) : (
                // Spacer column to match drawer width
                <th
                  style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }}
                ></th>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          {/* Virtualized rows for performance */}
          {(() => {
            const virtualRows = rowVirtualizer.getVirtualItems();
            const totalSize = rowVirtualizer.getTotalSize();
            const rows = table.getRowModel().rows;
            const columnCount = table.getAllColumns().length + 1; // +1 for spacer

            // Calculate padding to maintain scroll position (only when virtualizing)
            const paddingTop =
              virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
            const paddingBottom =
              virtualRows.length > 0
                ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
                : 0;

            // Test mode: render all rows without virtualization
            if (disableVirtualization) {
              return (
                <>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      data-index={row.index}
                      data-selected={
                        selectedRows.has(row.index) ? "true" : undefined
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          cell={cell}
                          rowIndex={row.index}
                          activeDatasetId={activeDatasetId}
                          isLoading={isLoadingExperiment || isLoadingDatasets}
                        />
                      ))}
                      {/* Spacer column to match drawer width */}
                      <td
                        style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }}
                      />
                    </tr>
                  ))}
                </>
              );
            }

            return (
              <>
                {/* Top padding row */}
                {paddingTop > 0 && (
                  <tr>
                    <td
                      style={{ height: `${paddingTop}px`, padding: 0 }}
                      colSpan={columnCount}
                    />
                  </tr>
                )}
                {/* Render only virtualized rows - empty until container is measured */}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (!row) return null;
                  return (
                    <tr
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      data-selected={
                        selectedRows.has(row.index) ? "true" : undefined
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          cell={cell}
                          rowIndex={row.index}
                          activeDatasetId={activeDatasetId}
                          isLoading={isLoadingExperiment || isLoadingDatasets}
                        />
                      ))}
                      {/* Spacer column to match drawer width */}
                      <td
                        style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }}
                      />
                    </tr>
                  );
                })}
                {/* Bottom padding row */}
                {paddingBottom > 0 && (
                  <tr>
                    <td
                      style={{ height: `${paddingBottom}px`, padding: 0 }}
                      colSpan={columnCount}
                    />
                  </tr>
                )}
              </>
            );
          })()}
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
