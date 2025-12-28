import { Box, Checkbox, HStack, Text } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { useDrawer, useDrawerParams, setFlowCallbacks } from "~/hooks/useDrawer";
import { PromptEditorDrawerHandler } from "./PromptEditorDrawerHandler";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDatasetSync } from "../hooks/useDatasetSync";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useTableKeyboardNavigation } from "../hooks/useTableKeyboardNavigation";
import { convertInlineToRowRecords } from "../utils/datasetConversion";
import type {
  RunnerConfig,
  DatasetColumn,
  DatasetReference,
  SavedRecord,
} from "../types";
import type { DatasetColumnType } from "~/server/datasets/types";

import { TableCell, type ColumnType } from "./DatasetSection/TableCell";
import { RunnerCellContent } from "./RunnerSection/RunnerCell";
import { RunnerHeader } from "./RunnerSection/RunnerHeader";
import { ColumnTypeIcon, SuperHeader } from "./TableUI";
import { SelectionToolbar } from "./SelectionToolbar";

// ============================================================================
// Types
// ============================================================================

type RowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  runners: Record<
    string,
    { output: unknown; evaluators: Record<string, unknown> }
  >;
};

// ============================================================================
// Main Component
// ============================================================================

type EvaluationsV3TableProps = {
  isLoadingExperiment?: boolean;
  isLoadingDatasets?: boolean;
};

export function EvaluationsV3Table({
  isLoadingExperiment = false,
  isLoadingDatasets = false,
}: EvaluationsV3TableProps) {
  const { openDrawer, closeDrawer, drawerOpen } = useDrawer();
  const { project } = useOrganizationTeamProject();

  // Sync saved dataset changes to DB
  useDatasetSync();

  const {
    datasets,
    activeDatasetId,
    evaluators,
    runners,
    results,
    ui,
    openOverlay,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    deleteSelectedRows,
    getRowCount,
    addDataset,
    setActiveDataset,
    removeDataset,
    updateDataset,
    setColumnWidths,
    toggleColumnVisibility,
    addRunner,
    updateRunner,
    removeRunner,
    addEvaluator,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      runners: state.runners,
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
      openOverlay: state.openOverlay,
      setSelectedCell: state.setSelectedCell,
      setEditingCell: state.setEditingCell,
      toggleRowSelection: state.toggleRowSelection,
      selectAllRows: state.selectAllRows,
      clearRowSelection: state.clearRowSelection,
      deleteSelectedRows: state.deleteSelectedRows,
      getRowCount: state.getRowCount,
      addDataset: state.addDataset,
      setActiveDataset: state.setActiveDataset,
      removeDataset: state.removeDataset,
      updateDataset: state.updateDataset,
      setColumnWidths: state.setColumnWidths,
      toggleColumnVisibility: state.toggleColumnVisibility,
      addRunner: state.addRunner,
      updateRunner: state.updateRunner,
      removeRunner: state.removeRunner,
      addEvaluator: state.addEvaluator,
    })),
  );

  // State to track pending dataset loads
  const [pendingDatasetLoad, setPendingDatasetLoad] = useState<{
    datasetId: string;
    name: string;
    columnTypes: { name: string; type: DatasetColumnType }[];
  } | null>(null);

  // Query to load dataset records when adding a saved dataset
  const savedDatasetRecords = api.datasetRecord.getAll.useQuery(
    {
      projectId: project?.id ?? "",
      datasetId: pendingDatasetLoad?.datasetId ?? "",
    },
    {
      enabled: !!project?.id && !!pendingDatasetLoad,
    },
  );

  // Effect to handle when saved dataset records finish loading
  useEffect(() => {
    if (
      pendingDatasetLoad &&
      savedDatasetRecords.data &&
      !savedDatasetRecords.isLoading
    ) {
      const { datasetId, name, columnTypes } = pendingDatasetLoad;

      // Build columns
      const columns: DatasetColumn[] = columnTypes.map((col, index) => ({
        id: `${col.name}_${index}`,
        name: col.name,
        type: col.type,
      }));

      // Transform records to SavedRecord format
      const savedRecords: SavedRecord[] = (
        savedDatasetRecords.data?.datasetRecords ?? []
      ).map((record: { id: string; entry: unknown }) => ({
        id: record.id,
        ...Object.fromEntries(
          columnTypes.map((col) => [
            col.name,
            (record.entry as Record<string, unknown>)?.[col.name] ?? "",
          ]),
        ),
      }));

      const newDataset: DatasetReference = {
        id: `saved_${datasetId}`,
        name,
        type: "saved",
        datasetId,
        columns,
        savedRecords,
      };

      addDataset(newDataset);
      setActiveDataset(newDataset.id);
      setPendingDatasetLoad(null);
    }
  }, [
    pendingDatasetLoad,
    savedDatasetRecords.data,
    savedDatasetRecords.isLoading,
    addDataset,
    setActiveDataset,
  ]);

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
        datasetRecords: Array<{ id: string } & Record<string, string>>;
      }
    | undefined
  >(undefined);

  // State for editing dataset columns
  const [editDatasetDrawerOpen, setEditDatasetDrawerOpen] = useState(false);

  // Get drawer params from URL
  const drawerParams = useDrawerParams();

  // Handler for when a saved agent is selected from the drawer
  const handleSelectSavedAgent = useCallback(
    (savedAgent: TypedAgent) => {
      const config = savedAgent.config as Record<string, unknown>;

      // Convert TypedAgent to RunnerConfig format (agent type)
      // Agent type and workflow ID are fetched at runtime via dbAgentId when needed
      const runnerConfig: RunnerConfig = {
        id: `runner_${Date.now()}`, // Generate unique ID for the workbench
        type: "agent", // This is a runner of type "agent" (code/workflow)
        name: savedAgent.name,
        dbAgentId: savedAgent.id, // Reference to the database agent
        inputs: (config.inputs as RunnerConfig["inputs"]) ?? [
          { identifier: "input", type: "str" },
        ],
        outputs: (config.outputs as RunnerConfig["outputs"]) ?? [
          { identifier: "output", type: "str" },
        ],
        mappings: {},
        evaluatorIds: [],
      };
      addRunner(runnerConfig);
      closeDrawer();
    },
    [addRunner, closeDrawer],
  );

  // Handler for when a prompt is selected from the drawer
  const handleSelectPrompt = useCallback(
    (prompt: { id: string; name: string; versionId?: string }) => {
      // Convert prompt to RunnerConfig format (prompt type)
      const runnerConfig: RunnerConfig = {
        id: `runner_${Date.now()}`, // Generate unique ID for the workbench
        type: "prompt",
        name: prompt.name,
        promptId: prompt.id,
        promptVersionId: prompt.versionId,
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        evaluatorIds: [],
      };
      addRunner(runnerConfig);
      closeDrawer();
    },
    [addRunner, closeDrawer],
  );

  // Handler for opening the evaluator selector for a specific runner
  const handleAddEvaluatorForRunner = useCallback(
    (runnerId: string) => {
      openDrawer("evaluatorList", { urlParams: { runnerId } });
    },
    [openDrawer],
  );

  // tRPC utils for fetching agent data
  const trpcUtils = api.useContext();

  // Handler for editing a runner (clicking on the header)
  const handleEditRunner = useCallback(
    async (runner: RunnerConfig) => {
      if (runner.type === "prompt") {
        openDrawer("promptEditor", { promptId: runner.promptId, urlParams: { runnerId: runner.id } });
      } else if (runner.type === "agent" && runner.dbAgentId) {
        // Fetch the agent to determine its type
        try {
          const agent = await trpcUtils.agents.getById.fetch({
            projectId: project?.id ?? "",
            id: runner.dbAgentId,
          });

          if (agent?.type === "workflow") {
            // Open workflow in new tab
            const config = agent.config as Record<string, unknown>;
            const workflowId = config.workflowId as string | undefined;
            if (workflowId) {
              const workflowUrl = `/${project?.slug}/studio/${workflowId}`;
              window.open(workflowUrl, "_blank");
            }
          } else {
            // Code agent - open code editor drawer
            openDrawer("agentCodeEditor", { urlParams: { runnerId: runner.id, agentId: runner.dbAgentId ?? "" } });
          }
        } catch (error) {
          console.error("Failed to fetch agent:", error);
        }
      }
    },
    [project?.id, project?.slug, trpcUtils.agents.getById, openDrawer],
  );

  // Handler for removing a runner from the workbench
  const handleRemoveRunner = useCallback(
    (runnerId: string) => {
      removeRunner(runnerId);
    },
    [removeRunner],
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
            setPendingDatasetLoad({
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
            setPendingDatasetLoad({
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
      onSaveAsDataset: (dataset: DatasetReference) => {
        if (dataset.type !== "inline" || !dataset.inline) return;

        // Convert inline dataset to row-based format, filtering empty rows
        const columns = dataset.inline.columns;
        const datasetRecords = convertInlineToRowRecords(
          columns,
          dataset.inline.records,
        );

        setDatasetToSave({
          name: dataset.name,
          columnTypes: columns.map((col) => ({
            name: col.name,
            type: col.type as DatasetColumnType,
          })),
          datasetRecords,
        });
        setSaveAsDatasetDrawerOpen(true);
      },
    }),
    [openDrawer, addDataset, setActiveDataset],
  );

  // Create a map of evaluator IDs to evaluator configs for quick lookup
  const evaluatorsMap = useMemo(
    () => new Map(evaluators.map((e) => [e.id, e])),
    [evaluators],
  );

  const tableRef = useRef<HTMLTableElement>(null);
  const rowCount = getRowCount(activeDatasetId);
  // Always show at least 3 rows, and always include 1 extra empty row at the end (Excel-like behavior)
  const displayRowCount = Math.max(rowCount + 1, 3);
  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

  // Get columns from active dataset, filtering out hidden columns
  const allDatasetColumns = activeDataset?.columns ?? [];
  const datasetColumns = useMemo(
    () => allDatasetColumns.filter((col) => !ui.hiddenColumns.has(col.name)),
    [allDatasetColumns, ui.hiddenColumns],
  );

  // Keyboard navigation hook - handles arrow keys, Tab, Enter, Escape
  useTableKeyboardNavigation({
    datasetColumns,
    runners,
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
  const rowData = useMemo((): RowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => ({
      rowIndex: index,
      dataset: Object.fromEntries(
        datasetColumns.map((col) => [
          col.id,
          getCellValue(activeDatasetId, index, col.id),
        ]),
      ),
      runners: Object.fromEntries(
        runners.map((runner) => [
          runner.id,
          {
            output: results.runnerOutputs[runner.id]?.[index] ?? null,
            evaluators: Object.fromEntries(
              runner.evaluatorIds.map((evaluatorId) => [
                evaluatorId,
                results.evaluatorResults[runner.id]?.[evaluatorId]?.[index] ??
                  null,
              ]),
            ),
          },
        ]),
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeDataset triggers re-render when data changes
  }, [
    activeDatasetId,
    activeDataset,
    datasetColumns,
    runners,
    results,
    displayRowCount,
    getCellValue,
  ]);

  // Build columns
  const columnHelper = createColumnHelper<RowData>();

  const columns = useMemo(() => {
    const cols: ColumnDef<RowData>[] = [];

    // Checkbox column
    cols.push(
      columnHelper.display({
        id: "select",
        header: () => (
          <Checkbox.Root
            checked={
              allSelected ? true : someSelected ? "indeterminate" : false
            }
            onCheckedChange={() => {
              if (allSelected) {
                clearRowSelection();
              } else {
                selectAllRows(rowCount);
              }
            }}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        ),
        cell: (info) => (
          <Checkbox.Root
            checked={selectedRows.has(info.row.index)}
            onCheckedChange={() => toggleRowSelection(info.row.index)}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        ),
        size: 40,
        meta: {
          columnType: "checkbox" as ColumnType,
          columnId: "__checkbox__",
        },
      }),
    );

    // Dataset columns from active dataset
    for (const column of datasetColumns) {
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
        }) as ColumnDef<RowData>,
      );
    }

    // Runner columns (each runner is ONE column, with output + evaluators inside)
    for (const runner of runners) {
      cols.push(
        columnHelper.accessor((row) => row.runners[runner.id], {
          id: `runner.${runner.id}`,
          header: () => (
            <RunnerHeader
              runner={runner}
              onEdit={handleEditRunner}
              onRemove={handleRemoveRunner}
            />
          ),
          cell: (info) => {
            const data = info.getValue() as {
              output: unknown;
              evaluators: Record<string, unknown>;
            };
            return (
              <RunnerCellContent
                runner={runner}
                output={data?.output}
                evaluatorResults={data?.evaluators ?? {}}
                row={info.row.index}
                evaluatorsMap={evaluatorsMap}
                onAddEvaluator={handleAddEvaluatorForRunner}
              />
            );
          },
          size: 280,
          minSize: 200,
          meta: {
            columnType: "runner" as ColumnType,
            columnId: `runner.${runner.id}`,
          },
        }) as ColumnDef<RowData>,
      );
    }

    return cols;
  }, [
    datasetColumns,
    runners,
    evaluatorsMap,
    columnHelper,
    selectedRows,
    allSelected,
    someSelected,
    rowCount,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    handleAddEvaluatorForRunner,
    handleEditRunner,
    handleRemoveRunner,
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
  });

  // Calculate colspan for super headers
  const datasetColSpan = 1 + datasetColumns.length;
  // +1 for the spacer column that's always present
  const runnersColSpan = runners.length + 1;

  // Height of the super header row (Dataset/Agents row)
  const SUPER_HEADER_HEIGHT = 51;
  const DRAWER_WIDTH = 456;

  return (
    <Box
      width="full"
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
          backgroundColor: "white",
        },
        // Column header row (second row in thead)
        "& thead tr:nth-of-type(2) th": {
          position: "sticky",
          top: `${SUPER_HEADER_HEIGHT}px`,
          zIndex: 10,
          backgroundColor: "white",
        },
        "& th": {
          borderBottom: "1px solid var(--chakra-colors-gray-200)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          textAlign: "left",
          backgroundColor: "white",
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
            background: "var(--chakra-colors-blue-400)",
            opacity: 0,
            transition: "opacity 0.15s",
          },
        },
        // Only show indicator when hovering the resize area or actively resizing
        "& .resizer:hover::after, & .resizer.isResizing::after": {
          opacity: 1,
        },
        "& td": {
          borderBottom: "1px solid var(--chakra-colors-gray-100)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          fontSize: "13px",
          verticalAlign: "top",
          // CSS variable for fade overlay gradient
          "--cell-bg": "white",
        },
        "& tr:hover td": {
          backgroundColor: "var(--chakra-colors-gray-50)",
          // Update CSS variable for fade overlay on hover
          "--cell-bg": "var(--chakra-colors-gray-50)",
        },
        // Selected row styling
        "& tr[data-selected='true'] td": {
          backgroundColor: "var(--chakra-colors-blue-50)",
          "--cell-bg": "var(--chakra-colors-blue-50)",
          "border-color": "var(--chakra-colors-blue-100)",
        },
        "& tr:has(+ tr[data-selected='true']) td": {
          "border-bottom-color": "var(--chakra-colors-blue-100)",
        },
      }}
    >
      <table ref={tableRef}>
        <thead>
          <tr>
            <SuperHeader
              type="dataset"
              colSpan={datasetColSpan}
              activeDataset={activeDataset}
              datasetHandlers={datasetHandlers}
              isLoading={isLoadingExperiment}
            />
            <SuperHeader
              type="runners"
              colSpan={runnersColSpan}
              onAddClick={() => {
                // Set flow callbacks for the entire add-runner flow
                setFlowCallbacks("promptList", { onSelect: handleSelectPrompt });
                setFlowCallbacks("promptEditor", { onSave: handleSelectPrompt });
                setFlowCallbacks("agentList", { onSelect: handleSelectSavedAgent });
                setFlowCallbacks("agentCodeEditor", { onSave: handleSelectSavedAgent });
                setFlowCallbacks("workflowSelector", { onSave: handleSelectSavedAgent });
                openDrawer("runnerTypeSelector");
              }}
              showWarning={runners.length === 0}
              hasComparison={runners.length > 0}
              isLoading={isLoadingExperiment}
            />
          </tr>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} style={{ width: header.getSize() }}>
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
              ))}
              {runners.length === 0 ? (
                // Spacer column to match drawer width + default runner column width
                <th style={{ width: DRAWER_WIDTH + 280, minWidth: DRAWER_WIDTH + 280 }}>
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">
                    Click "+ Add" above to get started
                  </Text>
                </th>
              ) : (
                // Spacer column to match drawer width
                <th style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }}></th>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              data-selected={selectedRows.has(row.index) ? "true" : undefined}
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
              <td style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }} />
            </tr>
          ))}
        </tbody>
      </table>

      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={() => console.log("Run selected:", Array.from(selectedRows))}
        onDelete={() => deleteSelectedRows(activeDatasetId)}
        onClear={clearRowSelection}
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
            // Update the dataset to be a saved reference
            const updatedDataset: DatasetReference = {
              ...currentDataset,
              type: "saved",
              datasetId: savedDataset.datasetId,
              inline: undefined,
              columns,
            };
            // Remove the old dataset and add the new one
            removeDataset(currentDataset.id);
            addDataset(updatedDataset);
            setActiveDataset(updatedDataset.id);
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

      {/* Handler for PromptEditorDrawer - manages local config state */}
      <PromptEditorDrawerHandler
        runnerId={drawerParams.runnerId}
        isOpen={drawerOpen("promptEditor")}
        onSelectPrompt={handleSelectPrompt}
      />
    </Box>
  );
}
