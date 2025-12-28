import { useEffect } from "react";
import type { DatasetColumn, RunnerConfig } from "../types";

type ColumnType = "checkbox" | "dataset" | "runner";

type NavigableColumn = {
  id: string;
  type: ColumnType;
};

type UseTableKeyboardNavigationParams = {
  datasetColumns: DatasetColumn[];
  runners: RunnerConfig[];
  displayRowCount: number;
  editingCell: { row: number; columnId: string } | undefined;
  selectedCell: { row: number; columnId: string } | undefined;
  setSelectedCell: (cell: { row: number; columnId: string } | undefined) => void;
  setEditingCell: (cell: { row: number; columnId: string } | undefined) => void;
  toggleRowSelection: (rowIndex: number) => void;
};

/**
 * Builds the list of navigable columns in order: checkbox, dataset columns, runner columns
 */
export const buildNavigableColumns = (
  datasetColumns: DatasetColumn[],
  runners: RunnerConfig[]
): NavigableColumn[] => {
  const cols: NavigableColumn[] = [];

  // Checkbox column
  cols.push({ id: "__checkbox__", type: "checkbox" });

  // Dataset columns
  for (const col of datasetColumns) {
    cols.push({ id: col.id, type: "dataset" });
  }

  // Runner columns
  for (const runner of runners) {
    cols.push({ id: `runner.${runner.id}`, type: "runner" });
  }

  return cols;
};

/**
 * Hook to handle keyboard navigation in the evaluations table.
 * Supports arrow keys, Tab/Shift+Tab, Enter/Space for actions, and Escape to clear.
 */
export const useTableKeyboardNavigation = ({
  datasetColumns,
  runners,
  displayRowCount,
  editingCell,
  selectedCell,
  setSelectedCell,
  setEditingCell,
  toggleRowSelection,
}: UseTableKeyboardNavigationParams): NavigableColumn[] => {
  const allColumns = buildNavigableColumns(datasetColumns, runners);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if we're editing a cell
      if (editingCell) return;

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
