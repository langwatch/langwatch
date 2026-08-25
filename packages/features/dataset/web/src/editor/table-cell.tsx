import { Skeleton, VStack } from "@chakra-ui/react";
import { type Cell, flexRender, type RowData } from "@tanstack/react-table";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { type DatasetTableRowData, useDatasetTable } from "./dataset-table-context";
import { EditableCell } from "./editable-cell";

/**
 * How a column behaves in the shared dataset table. "dataset" cells are
 * editable via EditableCell; "checkbox" toggles row selection; anything else
 * (e.g. the workbench's "target" columns) renders through flexRender.
 */
export type ColumnType = "checkbox" | "dataset" | "target" | "comparison";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    columnType?: ColumnType;
    columnId?: string;
    dataType?: DatasetColumnType; // The actual data type (string, json, list, etc.)
  }
}

type TableCellProps<TData extends DatasetTableRowData> = {
  cell: Cell<TData, unknown>;
  rowIndex: number;
  activeDatasetId: string;
  isLoading?: boolean;
};

/**
 * Renders a single table cell with selection and interaction support.
 * Handles click/double-click for selection/editing, and applies visual styles.
 */
export const TableCell = <TData extends DatasetTableRowData>({
  cell,
  rowIndex,
  activeDatasetId,
  isLoading,
}: TableCellProps<TData>) => {
  const { selectedCell, setSelectedCell, setEditingCell, toggleRowSelection } =
    useDatasetTable();

  const meta = cell.column.columnDef.meta;

  if (!meta?.columnType || !meta.columnId) {
    return (
      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
    );
  }

  const { columnId, columnType, dataType } = meta;

  const isSelected =
    selectedCell?.row === rowIndex && selectedCell?.columnId === columnId;

  const handleSelect = () => {
    setSelectedCell({ row: rowIndex, columnId });
  };

  const handleActivate = () => {
    if (columnType === "dataset") {
      setSelectedCell({ row: rowIndex, columnId });
      setEditingCell({ row: rowIndex, columnId });
    } else if (columnType === "checkbox") {
      toggleRowSelection(rowIndex);
    }
  };

  const selectedStyles = {
    outline: isSelected ? "2px solid var(--chakra-colors-blue-500)" : "none",
    outlineOffset: "-1px",
    position: isSelected ? ("relative" as const) : void 0,
    zIndex: isSelected ? 5 : void 0,
    height: "100%",
  };

  if (isLoading && columnType !== "checkbox") {
    return (
      <td key={cell.id}>
        <VStack align="stretch" gap={1}>
          <Skeleton height="14px" width="100%" />
          <Skeleton height="14px" width="100%" />
          <Skeleton height="14px" width="80%" />
        </VStack>
      </td>
    );
  }

  if (columnType === "dataset") {
    const cellValue = cell.getValue();

    return (
      <td
        key={cell.id}
        onClick={handleSelect}
        onDoubleClick={handleActivate}
        style={selectedStyles}
      >
        <EditableCell
          value={typeof cellValue === "string" ? cellValue : ""}
          row={rowIndex}
          columnId={columnId}
          datasetId={activeDatasetId}
          dataType={dataType}
        />
      </td>
    );
  }

  return (
    <td
      key={cell.id}
      onClick={handleSelect}
      onDoubleClick={handleActivate}
      style={{
        ...selectedStyles,
        verticalAlign: "top",
      }}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>
  );
};
