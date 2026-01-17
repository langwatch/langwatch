import { Skeleton } from "@chakra-ui/react";
import { type Cell, flexRender } from "@tanstack/react-table";
import type { DatasetColumnType } from "~/server/datasets/types";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { EditableCell } from "./EditableCell";

// ============================================================================
// Types
// ============================================================================

export type ColumnType = "checkbox" | "dataset" | "target";

type ColumnMeta = {
  columnType: ColumnType;
  columnId: string;
  dataType?: DatasetColumnType; // The actual data type (string, json, list, etc.)
};

type RowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  targets: Record<
    string,
    { output: unknown; evaluators: Record<string, unknown> }
  >;
};

type TableCellProps = {
  cell: Cell<RowData, unknown>;
  rowIndex: number;
  activeDatasetId: string;
  isLoading?: boolean;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a single table cell with selection and interaction support.
 * Handles click/double-click for selection/editing, and applies visual styles.
 */
export const TableCell = ({
  cell,
  rowIndex,
  activeDatasetId,
  isLoading,
}: TableCellProps) => {
  const { selectedCell, setSelectedCell, setEditingCell, toggleRowSelection } =
    useEvaluationsV3Store((state) => ({
      selectedCell: state.ui.selectedCell,
      setSelectedCell: state.setSelectedCell,
      setEditingCell: state.setEditingCell,
      toggleRowSelection: state.toggleRowSelection,
    }));

  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;

  // Cells without meta just render normally
  if (!meta) {
    return (
      <td key={cell.id}>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </td>
    );
  }

  const isSelected =
    selectedCell?.row === rowIndex && selectedCell?.columnId === meta.columnId;

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

  // Selected cell styles
  const selectedStyles = {
    outline: isSelected ? "2px solid var(--chakra-colors-blue-500)" : "none",
    outlineOffset: "-1px",
    position: isSelected ? ("relative" as const) : undefined,
    zIndex: isSelected ? 5 : undefined,
    userSelect: "none" as const,
  };

  // Show skeleton when loading (except checkbox column)
  if (isLoading && meta.columnType !== "checkbox") {
    return (
      <td key={cell.id} style={{ verticalAlign: "middle" }}>
        <Skeleton height="16px" width="100%" />
      </td>
    );
  }

  // For dataset cells, use the EditableCell component
  if (meta.columnType === "dataset") {
    return (
      <td
        key={cell.id}
        onClick={handleSelect}
        onDoubleClick={handleActivate}
        style={selectedStyles}
      >
        <EditableCell
          value={(cell.getValue() as string) ?? ""}
          row={rowIndex}
          columnId={meta.columnId}
          datasetId={activeDatasetId}
          dataType={meta.dataType}
        />
      </td>
    );
  }

  // For other cells (checkbox, target)
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
