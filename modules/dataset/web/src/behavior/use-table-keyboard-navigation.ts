import { useEffect } from "react";

type ColumnType = "checkbox" | "dataset" | "target";

type NavigableColumn = {
  id: string;
  type: ColumnType;
};

type UseTableKeyboardNavigationParams = {
  datasetColumns: Array<{ id: string }>;
  targets: Array<{ id: string }>;
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
  datasetColumns: Array<{ id: string }>,
  targets: Array<{ id: string }>,
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

  switch (event.key) {
    case "Enter":
    case " ":
      event.preventDefault();
      if (currentCol?.type === "checkbox") {
        toggleRowSelection(selectedCell.row);
      } else if (currentCol?.type === "dataset") {
        setEditingCell({ row: selectedCell.row, columnId: selectedCell.columnId });
      }
      break;

    case "ArrowUp":
      event.preventDefault();
      if (selectedCell.row > 0) {
        setSelectedCell({ row: selectedCell.row - 1, columnId: selectedCell.columnId });
      }
      break;

    case "ArrowDown":
      event.preventDefault();
      if (selectedCell.row < displayRowCount - 1) {
        setSelectedCell({ row: selectedCell.row + 1, columnId: selectedCell.columnId });
      }
      break;

    case "ArrowLeft":
      event.preventDefault();
      if (currentColIndex > 0) {
        setSelectedCell({ row: selectedCell.row, columnId: allColumns[currentColIndex - 1]!.id });
      }
      break;

    case "ArrowRight":
      event.preventDefault();
      if (currentColIndex < allColumns.length - 1) {
        setSelectedCell({ row: selectedCell.row, columnId: allColumns[currentColIndex + 1]!.id });
      }
      break;

    case "Tab":
      event.preventDefault();
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
      break;

    case "Escape":
      event.preventDefault();
      setSelectedCell(undefined);
      break;
  }
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
