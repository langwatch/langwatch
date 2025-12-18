import { Box, Checkbox, HStack, Text } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Cell,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code } from "react-feather";

import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import { LLMIcon } from "~/components/icons/LLMIcon";
import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { useDrawer } from "~/hooks/useDrawer";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { AgentConfig, DatasetColumn, DatasetReference, EvaluatorConfig } from "../types";
import type { DatasetColumnType } from "~/server/datasets/types";

import { EditableCell } from "./DatasetSection/EditableCell";
import { AgentCellContent, AgentHeader } from "./AgentSection/AgentCell";
import {
  ColumnTypeIcon,
  SelectionToolbar,
  SuperHeader,
  type DatasetHandlers,
} from "./TableUI";

// ============================================================================
// Types
// ============================================================================

type RowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  agents: Record<string, { output: unknown; evaluators: Record<string, unknown> }>;
};

type ColumnType = "checkbox" | "dataset" | "agent";

// ============================================================================
// Main Component
// ============================================================================

export function EvaluationsV3Table() {
  const { openDrawer } = useDrawer();

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
    getRowCount,
    addDataset,
    setActiveDataset,
    removeDataset,
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
    getRowCount: state.getRowCount,
    addDataset: state.addDataset,
    setActiveDataset: state.setActiveDataset,
    removeDataset: state.removeDataset,
  }));

  // State for edit dataset panel
  const [showEditDatasetPanel, setShowEditDatasetPanel] = useState(false);

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

  // Dataset handlers for drawer integration
  const datasetHandlers = useMemo(
    () => ({
      onSelectExisting: () => {
        openDrawer("selectDataset", {
          onSelect: (dataset: { datasetId: string; name: string; columnTypes: { name: string; type: DatasetColumnType }[] }) => {
            // Add the selected dataset to the workbench
            const columns: DatasetColumn[] = dataset.columnTypes.map((col, index) => ({
              id: `${col.name}_${index}`,
              name: col.name,
              type: col.type,
            }));
            const newDataset: DatasetReference = {
              id: `saved_${dataset.datasetId}`,
              name: dataset.name,
              type: "saved",
              datasetId: dataset.datasetId,
              columns,
            };
            addDataset(newDataset);
            setActiveDataset(newDataset.id);
          },
        });
      },
      onUploadCSV: () => {
        openDrawer("uploadCSV", {
          onSuccess: (params: { datasetId: string; name: string; columnTypes: { name: string; type: DatasetColumnType }[] }) => {
            // Add the uploaded dataset to the workbench
            const columns: DatasetColumn[] = params.columnTypes.map((col, index) => ({
              id: `${col.name}_${index}`,
              name: col.name,
              type: col.type,
            }));
            const newDataset: DatasetReference = {
              id: `saved_${params.datasetId}`,
              name: params.name,
              type: "saved",
              datasetId: params.datasetId,
              columns,
            };
            addDataset(newDataset);
            setActiveDataset(newDataset.id);
          },
        });
      },
      onEditDataset: () => {
        setShowEditDatasetPanel(true);
      },
      onSaveAsDataset: (dataset: DatasetReference) => {
        if (dataset.type !== "inline" || !dataset.inline) return;

        // Convert inline dataset to the format AddOrEditDatasetDrawer expects
        const columns = dataset.inline.columns;
        const records = dataset.inline.records;

        // Convert column-based records to row-based records
        const rowCount = Math.max(
          ...Object.values(records).map((arr) => arr.length),
          0
        );
        const datasetRecords: Array<{ id: string } & Record<string, string>> = [];

        for (let i = 0; i < rowCount; i++) {
          const row: { id: string } & Record<string, string> = { id: `row_${i}` };
          for (const col of columns) {
            row[col.name] = records[col.id]?.[i] ?? "";
          }
          datasetRecords.push(row);
        }

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
  const displayRowCount = Math.max(rowCount, 3);
  const selectedRows = ui.selectedRows;
  const allSelected = selectedRows.size === rowCount && rowCount > 0;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rowCount;

  // Get columns from active dataset
  const datasetColumns = activeDataset?.columns ?? [];

  // Build list of ALL navigable column IDs with their types
  const allColumns = useMemo(() => {
    const cols: Array<{ id: string; type: ColumnType }> = [];

    // Checkbox column
    cols.push({ id: "__checkbox__", type: "checkbox" });

    // Dataset columns
    for (const col of datasetColumns) {
      cols.push({ id: col.id, type: "dataset" });
    }

    // Agent columns
    for (const agent of agents) {
      cols.push({ id: `agent.${agent.id}`, type: "agent" });
    }

    return cols;
  }, [datasetColumns, agents]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if we're editing a cell
      if (ui.editingCell) return;

      const selectedCell = ui.selectedCell;
      if (!selectedCell) return;

      const currentColIndex = allColumns.findIndex(
        (c) => c.id === selectedCell.columnId
      );
      if (currentColIndex === -1) return;

      const currentCol = allColumns[currentColIndex];

      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          if (currentCol?.type === "checkbox") {
            toggleRowSelection(selectedCell.row);
          } else if (currentCol?.type === "dataset") {
            setEditingCell({
              row: selectedCell.row,
              columnId: selectedCell.columnId,
            });
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (selectedCell.row > 0) {
            setSelectedCell({
              row: selectedCell.row - 1,
              columnId: selectedCell.columnId,
            });
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (selectedCell.row < displayRowCount - 1) {
            setSelectedCell({
              row: selectedCell.row + 1,
              columnId: selectedCell.columnId,
            });
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (currentColIndex > 0) {
            setSelectedCell({
              row: selectedCell.row,
              columnId: allColumns[currentColIndex - 1]!.id,
            });
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (currentColIndex < allColumns.length - 1) {
            setSelectedCell({
              row: selectedCell.row,
              columnId: allColumns[currentColIndex + 1]!.id,
            });
          }
          break;

        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (currentColIndex > 0) {
              setSelectedCell({
                row: selectedCell.row,
                columnId: allColumns[currentColIndex - 1]!.id,
              });
            } else if (selectedCell.row > 0) {
              setSelectedCell({
                row: selectedCell.row - 1,
                columnId: allColumns[allColumns.length - 1]!.id,
              });
            }
          } else {
            if (currentColIndex < allColumns.length - 1) {
              setSelectedCell({
                row: selectedCell.row,
                columnId: allColumns[currentColIndex + 1]!.id,
              });
            } else if (selectedCell.row < displayRowCount - 1) {
              setSelectedCell({
                row: selectedCell.row + 1,
                columnId: allColumns[0]!.id,
              });
            }
          }
          break;

        case "Escape":
          e.preventDefault();
          setSelectedCell(undefined);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    ui.editingCell,
    ui.selectedCell,
    allColumns,
    displayRowCount,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  ]);

  // Build row data from active dataset records
  const rowData = useMemo((): RowData[] => {
    const inlineData = activeDataset?.inline;

    return Array.from({ length: displayRowCount }, (_, index) => ({
      rowIndex: index,
      dataset: Object.fromEntries(
        datasetColumns.map((col) => [
          col.id,
          inlineData?.records[col.id]?.[index] ?? "",
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
  }, [activeDataset, datasetColumns, agents, results, displayRowCount]);

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

  const table = useReactTable({
    data: rowData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Calculate colspan for super headers
  const datasetColSpan = 1 + datasetColumns.length;
  const agentsColSpan = Math.max(agents.length, 1);

  // Helper to render cell with selection support
  const renderCell = useCallback(
    (cell: Cell<RowData, unknown>, rowIndex: number) => {
      const meta = cell.column.columnDef.meta as
        | { columnType: ColumnType; columnId: string }
        | undefined;

      if (!meta) {
        return (
          <td key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      }

      const isSelected =
        ui.selectedCell?.row === rowIndex &&
        ui.selectedCell?.columnId === meta.columnId;

      const handleSelect = () => {
        setSelectedCell({ row: rowIndex, columnId: meta.columnId });
      };

      const handleActivate = () => {
        if (meta.columnType === "dataset") {
          setSelectedCell({ row: rowIndex, columnId: meta.columnId });
          setEditingCell({ row: rowIndex, columnId: meta.columnId });
        } else if (meta.columnType === "checkbox") {
          toggleRowSelection(rowIndex);
        }
      };

      // For dataset cells, use the EditableCell component
      if (meta.columnType === "dataset") {
        return (
          <td
            key={cell.id}
            onClick={handleSelect}
            onDoubleClick={handleActivate}
            style={{
              outline: isSelected
                ? "2px solid var(--chakra-colors-blue-500)"
                : "none",
              outlineOffset: "-1px",
              position: isSelected ? "relative" : undefined,
              zIndex: isSelected ? 5 : undefined,
              userSelect: "none",
            }}
          >
            <EditableCell
              value={(cell.getValue() as string) ?? ""}
              row={rowIndex}
              columnId={meta.columnId}
              datasetId={activeDatasetId}
            />
          </td>
        );
      }

      // For other cells
      return (
        <td
          key={cell.id}
          onClick={handleSelect}
          onDoubleClick={handleActivate}
          style={{
            outline: isSelected
              ? "2px solid var(--chakra-colors-blue-500)"
              : "none",
            outlineOffset: "-1px",
            position: isSelected ? "relative" : undefined,
            zIndex: isSelected ? 5 : undefined,
            userSelect: "none",
            verticalAlign: "top",
          }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      );
    },
    [ui.selectedCell, activeDatasetId, setSelectedCell, setEditingCell, toggleRowSelection]
  );

  return (
    <Box
      width="full"
      minHeight="full"
      css={{
        "& table": {
          width: "100%",
          borderCollapse: "collapse",
        },
        "& th": {
          borderBottom: "1px solid var(--chakra-colors-gray-200)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          textAlign: "left",
          backgroundColor: "white",
          fontWeight: "medium",
          fontSize: "13px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        },
        "& td": {
          borderBottom: "1px solid var(--chakra-colors-gray-100)",
          borderRight: "1px solid var(--chakra-colors-gray-100)",
          padding: "8px 12px",
          fontSize: "13px",
          verticalAlign: "top",
        },
        "& tr:hover td": {
          backgroundColor: "var(--chakra-colors-gray-50)",
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
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => renderCell(cell, row.index))}
              {agents.length === 0 && <td />}
            </tr>
          ))}
        </tbody>
      </table>

      <SelectionToolbar
        selectedCount={selectedRows.size}
        onRun={() => console.log("Run selected:", Array.from(selectedRows))}
        onDelete={() =>
          console.log("Delete selected:", Array.from(selectedRows))
        }
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
    </Box>
  );
}
