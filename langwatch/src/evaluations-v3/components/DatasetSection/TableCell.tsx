import { flexRender, type Cell } from "@tanstack/react-table";

import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { EditableCell } from "./EditableCell";

// ============================================================================
// Types
// ============================================================================

export type ColumnType = "checkbox" | "dataset" | "agent";

type ColumnMeta = {
  columnType: ColumnType;
  columnId: string;
};

type RowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  agents: Record<string, { output: unknown; evaluators: Record<string, unknown> }>;
};

type TableCellProps = {
  cell: Cell<RowData, unknown>;
  rowIndex: number;
  activeDatasetId: string;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a single table cell with selection and interaction support.
 * Handles click/double-click for selection/editing, and applies visual styles.
 */
export const TableCell = ({ cell, rowIndex, activeDatasetId }: TableCellProps) => {
  const {
    selectedCell,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  } = useEvaluationsV3Store((state) => ({
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
    selectedCell?.row === rowIndex &&
    selectedCell?.columnId === meta.columnId;

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
        />
      </td>
    );
  }

  // For other cells (checkbox, agent)
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
