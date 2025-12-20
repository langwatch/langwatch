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

import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useTableKeyboardNavigation } from "../hooks/useTableKeyboardNavigation";
import { convertInlineToRowRecords } from "../utils/datasetConversion";
import type { DatasetColumn, DatasetReference, SavedRecord } from "../types";
import type { DatasetColumnType } from "~/server/datasets/types";

import { TableCell, type ColumnType } from "./DatasetSection/TableCell";
import { AgentCellContent, AgentHeader } from "./AgentSection/AgentCell";
import {
  ColumnTypeIcon,
  SuperHeader,
} from "./TableUI";
import { SelectionToolbar } from "./SelectionToolbar";

// ============================================================================
// Types
// ============================================================================

type RowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  agents: Record<string, { output: unknown; evaluators: Record<string, unknown> }>;
};

// ============================================================================
// Main Component
// ============================================================================

export function EvaluationsV3Table() {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const {
    datasets,
    activeDatasetId,
    evaluators,
    agents,
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
    columnWidths,
    setColumnWidths,
    hiddenColumns,
    toggleColumnVisibility,
  } = useEvaluationsV3Store((state) => ({
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId,
    evaluators: state.evaluators,
    agents: state.agents,
    results: state.results,
    ui: state.ui,
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
    columnWidths: state.ui.columnWidths,
    setColumnWidths: state.setColumnWidths,
    hiddenColumns: state.ui.hiddenColumns,
    toggleColumnVisibility: state.toggleColumnVisibility,
  }));


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
    }
  );

  // Mutations for saved dataset records
  const updateSavedRecord = api.datasetRecord.update.useMutation();
  const deleteSavedRecords = api.datasetRecord.deleteMany.useMutation();

  // Get pending changes from store for syncing
  const { pendingSavedChanges, clearPendingChange } = useEvaluationsV3Store((state) => ({
    pendingSavedChanges: state.pendingSavedChanges,
    clearPendingChange: state.clearPendingChange,
  }));

  // Effect to sync pending changes to DB (debounced)
  const pendingChangesRef = useRef(pendingSavedChanges);
  pendingChangesRef.current = pendingSavedChanges;
  const datasetsRef = useRef(datasets);
  datasetsRef.current = datasets;

  useEffect(() => {
    if (!project?.id) return;

    // Find datasets and records that need syncing
    const datasetsToSync = Object.keys(pendingSavedChanges);
    if (datasetsToSync.length === 0) return;

    // Debounce sync to avoid too many requests
    const timeoutId = setTimeout(() => {
      for (const dbDatasetId of datasetsToSync) {
        const recordChanges = pendingChangesRef.current[dbDatasetId];
        if (!recordChanges) continue;

        // Find the dataset in our state to get the full record data
        const dataset = datasetsRef.current.find(
          (d) => d.type === "saved" && d.datasetId === dbDatasetId
        );

        // Separate deletions from updates
        const recordsToDelete: string[] = [];
        const recordsToUpdate: Array<{ recordId: string; changes: Record<string, unknown> }> = [];

        for (const [recordId, changes] of Object.entries(recordChanges)) {
          if (!changes || Object.keys(changes).length === 0) continue;

          if ("_delete" in changes && changes._delete === true) {
            recordsToDelete.push(recordId);
          } else {
            recordsToUpdate.push({ recordId, changes });
          }
        }

        // Handle deletions
        if (recordsToDelete.length > 0) {
          deleteSavedRecords.mutate(
            {
              projectId: project.id,
              datasetId: dbDatasetId,
              recordIds: recordsToDelete,
            },
            {
              onSuccess: () => {
                for (const recordId of recordsToDelete) {
                  clearPendingChange(dbDatasetId, recordId);
                }
              },
              onError: (error) => {
                console.error("Failed to delete saved records:", error);
              },
            }
          );
        }

        // Handle updates
        if (dataset?.savedRecords) {
          for (const { recordId } of recordsToUpdate) {
            // Find the full record to send all columns (backend replaces entire entry)
            const fullRecord = dataset.savedRecords.find((r) => r.id === recordId);
            if (!fullRecord) continue;

            // Build the full record data (excluding the 'id' field which is metadata)
            const { id: _id, ...recordData } = fullRecord;

            // Sync this record to DB with full data
            updateSavedRecord.mutate(
              {
                projectId: project.id,
                datasetId: dbDatasetId,
                recordId,
                updatedRecord: recordData,
              },
              {
                onSuccess: () => {
                  clearPendingChange(dbDatasetId, recordId);
                },
                onError: (error) => {
                  console.error("Failed to sync saved record:", error);
                },
              }
            );
          }
        }
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [pendingSavedChanges, project?.id, updateSavedRecord, deleteSavedRecords, clearPendingChange]);

  // Effect to handle when saved dataset records finish loading
  useEffect(() => {
    if (pendingDatasetLoad && savedDatasetRecords.data && !savedDatasetRecords.isLoading) {
      const { datasetId, name, columnTypes } = pendingDatasetLoad;

      // Build columns
      const columns: DatasetColumn[] = columnTypes.map((col, index) => ({
        id: `${col.name}_${index}`,
        name: col.name,
        type: col.type,
      }));

      // Transform records to SavedRecord format
      const savedRecords: SavedRecord[] = (savedDatasetRecords.data?.datasetRecords ?? []).map((record: { id: string; entry: unknown }) => ({
        id: record.id,
        ...Object.fromEntries(
          columnTypes.map((col) => [col.name, (record.entry as Record<string, unknown>)?.[col.name] ?? ""])
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
  }, [pendingDatasetLoad, savedDatasetRecords.data, savedDatasetRecords.isLoading, addDataset, setActiveDataset]);

  // Get the active dataset
  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId),
    [datasets, activeDatasetId]
  );

  // State for AddOrEditDatasetDrawer (for Save as dataset)
  const [saveAsDatasetDrawerOpen, setSaveAsDatasetDrawerOpen] = useState(false);
  const [datasetToSave, setDatasetToSave] = useState<{
    name: string;
    columnTypes: { name: string; type: DatasetColumnType }[];
    datasetRecords: Array<{ id: string } & Record<string, string>>;
  } | undefined>(undefined);

  // State for editing dataset columns
  const [editDatasetDrawerOpen, setEditDatasetDrawerOpen] = useState(false);

  // Dataset handlers for drawer integration
  const datasetHandlers = useMemo(
    () => ({
      onSelectExisting: () => {
        openDrawer("selectDataset", {
          onSelect: (dataset: { datasetId: string; name: string; columnTypes: { name: string; type: DatasetColumnType }[] }) => {
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
          onSuccess: (params: { datasetId: string; name: string; columnTypes: { name: string; type: DatasetColumnType }[] }) => {
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
        const datasetRecords = convertInlineToRowRecords(columns, dataset.inline.records);

        setDatasetToSave({
          name: dataset.name,
          columnTypes: columns.map((col) => ({ name: col.name, type: col.type as DatasetColumnType })),
          datasetRecords,
        });
        setSaveAsDatasetDrawerOpen(true);
      },
    }),
    [openDrawer, addDataset, setActiveDataset]
  );

  // Create a map of evaluator IDs to evaluator configs for quick lookup
  const evaluatorsMap = useMemo(
    () => new Map(evaluators.map((e) => [e.id, e])),
    [evaluators]
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
    () => allDatasetColumns.filter((col) => !hiddenColumns.has(col.name)),
    [allDatasetColumns, hiddenColumns]
  );

  // Keyboard navigation hook - handles arrow keys, Tab, Enter, Escape
  useTableKeyboardNavigation({
    datasetColumns,
    agents,
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
        ])
      ),
      agents: Object.fromEntries(
        agents.map((agent) => [
          agent.id,
          {
            output: results.agentOutputs[agent.id]?.[index] ?? null,
            evaluators: Object.fromEntries(
              agent.evaluatorIds.map((evaluatorId) => [
                evaluatorId,
                results.evaluatorResults[agent.id]?.[evaluatorId]?.[index] ?? null,
              ])
            ),
          },
        ])
      ),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeDataset triggers re-render when data changes
  }, [activeDatasetId, activeDataset, datasetColumns, agents, results, displayRowCount, getCellValue]);

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
      })
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
        }) as ColumnDef<RowData>
      );
    }

    // Agent columns (each agent is ONE column, with output + evaluators inside)
    for (const agent of agents) {
      cols.push(
        columnHelper.accessor((row) => row.agents[agent.id], {
          id: `agent.${agent.id}`,
          header: () => <AgentHeader agent={agent} />,
          cell: (info) => {
            const data = info.getValue() as {
              output: unknown;
              evaluators: Record<string, unknown>;
            };
            return (
              <AgentCellContent
                agent={agent}
                output={data?.output}
                evaluatorResults={data?.evaluators ?? {}}
                row={info.row.index}
                evaluatorsMap={evaluatorsMap}
              />
            );
          },
          size: 280,
          meta: {
            columnType: "agent" as ColumnType,
            columnId: `agent.${agent.id}`,
          },
        }) as ColumnDef<RowData>
      );
    }

    return cols;
  }, [
    datasetColumns,
    agents,
    evaluatorsMap,
    columnHelper,
    selectedRows,
    allSelected,
    someSelected,
    rowCount,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
  ]);

  // Column sizing state - initialize from store
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => columnWidths);

  // Sync column sizing changes to store (debounced to avoid excessive updates)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setColumnSizing((prev) => {
        const newSizing = typeof updater === "function" ? updater(prev) : updater;
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
    [setColumnWidths]
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
  const agentsColSpan = Math.max(agents.length, 1);

  // Height of the super header row (Dataset/Agents row)
  const SUPER_HEADER_HEIGHT = 51;

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
        }
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
            />
            <SuperHeader
              type="agents"
              colSpan={agentsColSpan}
              onAddClick={() => openOverlay("agent")}
              showWarning={agents.length === 0}
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
                        header.getContext()
                      )}
                  {/* Resize handle */}
                  {header.column.getCanResize() && (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={`resizer ${header.column.getIsResizing() ? "isResizing" : ""}`}
                    />
                  )}
                </th>
              ))}
              {agents.length === 0 && (
                <th style={{ minWidth: 200 }}>
                  <Text fontSize="xs" color="gray.400" fontStyle="italic">
                    Click "Add Agent" above
                  </Text>
                </th>
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
                />
              ))}
              {agents.length === 0 && <td />}
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
            const columns: DatasetColumn[] = savedDataset.columnTypes.map((col, index) => ({
              id: `${col.name}_${index}`,
              name: col.name,
              type: col.type as DatasetColumnType,
            }));
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
                datasetId: activeDataset.type === "saved" ? activeDataset.datasetId : undefined,
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
                        activeDataset.inline.records
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
          hiddenColumns,
          onToggleVisibility: toggleColumnVisibility,
        }}
        onSuccess={(updatedDataset) => {
          if (!activeDataset) return;

          // Build new columns from the drawer result
          const newColumns: DatasetColumn[] = updatedDataset.columnTypes.map((col, index) => ({
            id: `${col.name}_${index}`,
            name: col.name,
            type: col.type as DatasetColumnType,
          }));

          if (activeDataset.type === "inline") {
            // For inline datasets, update columns and map records
            const oldRecords = activeDataset.inline?.records ?? {};
            const newRecords: Record<string, string[]> = {};

            // Map old records to new columns (by name matching)
            const currentRowCount = getRowCount(activeDataset.id);
            for (const newCol of newColumns) {
              const oldCol = activeDataset.columns.find((c) => c.name === newCol.name);
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
