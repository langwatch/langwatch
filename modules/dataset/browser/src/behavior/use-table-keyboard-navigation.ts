import { useEffect } from "react";

type ColumnType = "checkbox" | "dataset" | "target";

type NavigableColumn = {
  id: string;
  type: ColumnType;
};

type UseTableKeyboardNavigationParams = {
  datasetColumns: { id: string }[];
  targets: { id: string }[];
  displayRowCount: number;
  editingCell: { row: number; columnId: string } | undefined;
  selectedCell: { row: number; columnId: string } | undefined;
  setSelectedCell: (cell: { row: number; columnId: string } | undefined) => void;
  setEditingCell: (cell: { row: number; columnId: string } | undefined) => void;
  toggleRowSelection: (rowIndex: number) => void;
};

/**
 * Builds the list of navigable columns in order: checkbox, dataset columns, target columns
 */
export const buildNavigableColumns = (
  datasetColumns: { id: string }[],
  targets: { id: string }[],
): NavigableColumn[] => {
  const cols: NavigableColumn[] = [];

  // Checkbox column
  cols.push({ id: "__checkbox__", type: "checkbox" });

  // Dataset columns
  for (const col of datasetColumns) {
    cols.push({ id: col.id, type: "dataset" });
  }

  // Target columns
  for (const target of targets) {
    cols.push({ id: `target.${target.id}`, type: "target" });
  }

  return cols;
};

type Cell = { row: number; columnId: string };

/** Moves the selection one column left, or wraps to the previous row's last
 *  column. */
function selectPreviousCell({
  selectedCell,
  currentColIndex,
  allColumns,
  setSelectedCell,
}: {
  selectedCell: Cell;
  currentColIndex: number;
  allColumns: NavigableColumn[];
  setSelectedCell: (cell: Cell | undefined) => void;
}): void {
  if (currentColIndex > 0) {
    setSelectedCell({ row: selectedCell.row, columnId: allColumns[currentColIndex - 1]!.id });
  } else if (selectedCell.row > 0) {
    setSelectedCell({
      row: selectedCell.row - 1,
      columnId: allColumns[allColumns.length - 1]!.id,
    });
  }
}

/** Moves the selection one column right, or wraps to the next row's first
 *  column. */
function selectNextCell({
  selectedCell,
  currentColIndex,
  allColumns,
  displayRowCount,
  setSelectedCell,
}: {
  selectedCell: Cell;
  currentColIndex: number;
  allColumns: NavigableColumn[];
  displayRowCount: number;
  setSelectedCell: (cell: Cell | undefined) => void;
}): void {
  if (currentColIndex < allColumns.length - 1) {
    setSelectedCell({ row: selectedCell.row, columnId: allColumns[currentColIndex + 1]!.id });
  } else if (selectedCell.row < displayRowCount - 1) {
    setSelectedCell({ row: selectedCell.row + 1, columnId: allColumns[0]!.id });
  }
}

/** Applies one keydown to the table's cell selection/editing state. A no-op
 *  while a cell is being edited or nothing is selected. */
function handleTableKeyDown({
  event,
  editingCell,
  selectedCell,
  allColumns,
  displayRowCount,
  setSelectedCell,
  setEditingCell,
  toggleRowSelection,
}: {
  event: KeyboardEvent;
  editingCell: Cell | undefined;
  selectedCell: Cell | undefined;
  allColumns: NavigableColumn[];
  displayRowCount: number;
  setSelectedCell: (cell: Cell | undefined) => void;
  setEditingCell: (cell: Cell | undefined) => void;
  toggleRowSelection: (rowIndex: number) => void;
}): void {
  if (editingCell) return;
  if (!selectedCell) return;

  const currentColIndex = allColumns.findIndex((c) => c.id === selectedCell.columnId);
  if (currentColIndex === -1) return;

  const currentCol = allColumns[currentColIndex];

  if (!HANDLED_KEYS.has(event.key)) return;
  event.preventDefault();

  if (event.key === "Escape") {
    setSelectedCell(undefined);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    if (currentCol?.type === "checkbox") toggleRowSelection(selectedCell.row);
    else if (currentCol?.type === "dataset") setEditingCell({ ...selectedCell });
    return;
  }
  if (event.key === "Tab") {
    if (event.shiftKey) {
      selectPreviousCell({ selectedCell, currentColIndex, allColumns, setSelectedCell });
    } else {
      selectNextCell({
        selectedCell,
        currentColIndex,
        allColumns,
        displayRowCount,
        setSelectedCell,
      });
    }
    return;
  }
  const target = arrowTarget({
    key: event.key,
    selectedCell,
    currentColIndex,
    allColumns,
    displayRowCount,
  });
  if (target) setSelectedCell(target);
}

const HANDLED_KEYS = new Set([
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "Escape",
]);

/** The cell an arrow key moves to, or nothing at the table's edge. */
function arrowTarget({
  key,
  selectedCell,
  currentColIndex,
  allColumns,
  displayRowCount,
}: {
  key: string;
  selectedCell: Cell;
  currentColIndex: number;
  allColumns: NavigableColumn[];
  displayRowCount: number;
}): Cell | undefined {
  const { row, columnId } = selectedCell;
  if (key === "ArrowUp") return row > 0 ? { row: row - 1, columnId } : undefined;
  if (key === "ArrowDown")
    return row < displayRowCount - 1 ? { row: row + 1, columnId } : undefined;
  const nextColumn =
    key === "ArrowLeft" ? allColumns[currentColIndex - 1] : allColumns[currentColIndex + 1];
  return key === "ArrowLeft" || key === "ArrowRight"
    ? nextColumn && { row, columnId: nextColumn.id }
    : undefined;
}

/**
 * Hook to handle keyboard navigation in the evaluations table.
 * Supports arrow keys, Tab/Shift+Tab, Enter/Space for actions, and Escape to clear.
 */
export const useTableKeyboardNavigation = ({
  datasetColumns,
  targets,
  displayRowCount,
  editingCell,
  selectedCell,
  setSelectedCell,
  setEditingCell,
  toggleRowSelection,
}: UseTableKeyboardNavigationParams): NavigableColumn[] => {
  const allColumns = buildNavigableColumns(datasetColumns, targets);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) =>
      handleTableKeyDown({
        event,
        editingCell,
        selectedCell,
        allColumns,
        displayRowCount,
        setSelectedCell,
        setEditingCell,
        toggleRowSelection,
      });

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    editingCell,
    selectedCell,
    allColumns,
    displayRowCount,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  ]);

  return allColumns;
};
