/**
 * Utilities for determining which cells will be executed based on execution scope.
 * This is the single source of truth for execution cell calculation on the frontend.
 * 
 * The same logic exists on the backend in orchestrator.ts - these must stay in sync.
 */

import type { ExecutionScope } from "~/server/evaluations-v3/execution/types";
import { isRowEmpty } from "./emptyRowDetection";

/**
 * A cell identifier - uniquely identifies a cell in the workbench.
 */
export type CellId = {
  rowIndex: number;
  targetId: string;
};

/**
 * Parameters for computing execution cells.
 */
export type ComputeExecutionCellsParams = {
  /** The execution scope (full, rows, target, or cell) */
  scope: ExecutionScope;
  /** All target IDs in the workbench */
  targetIds: string[];
  /** Dataset rows as records */
  datasetRows: Record<string, unknown>[];
};

/**
 * Computes exactly which cells will be executed based on the scope.
 * This accounts for:
 * - The execution scope type (full, rows, target, cell)
 * - Empty row filtering (empty rows are always skipped)
 * 
 * Returns an array of cell identifiers that will be executed.
 */
export const computeExecutionCells = ({
  scope,
  targetIds,
  datasetRows,
}: ComputeExecutionCellsParams): CellId[] => {
  const cells: CellId[] = [];

  // Determine which row indices to process based on scope
  let rowIndices: number[];
  switch (scope.type) {
    case "full":
      rowIndices = datasetRows.map((_, i) => i);
      break;
    case "rows":
      rowIndices = scope.rowIndices.filter((i) => i >= 0 && i < datasetRows.length);
      break;
    case "target":
      rowIndices = datasetRows.map((_, i) => i);
      break;
    case "cell":
      rowIndices = [scope.rowIndex];
      break;
    default:
      rowIndices = [];
  }

  // Determine which target IDs to process based on scope
  let scopeTargetIds: string[];
  switch (scope.type) {
    case "full":
    case "rows":
      scopeTargetIds = targetIds;
      break;
    case "target":
    case "cell":
      scopeTargetIds = [scope.targetId];
      break;
    default:
      scopeTargetIds = [];
  }

  // Generate cells, skipping empty rows
  for (const rowIndex of rowIndices) {
    const row = datasetRows[rowIndex];
    if (!row) continue;

    // Skip empty rows
    if (isRowEmpty(row)) continue;

    for (const targetId of scopeTargetIds) {
      // Verify target exists
      if (!targetIds.includes(targetId)) continue;

      cells.push({ rowIndex, targetId });
    }
  }

  return cells;
};

/**
 * Creates a Set for fast lookup of cells being executed.
 * The key format is "rowIndex:targetId".
 */
export const createExecutionCellSet = (cells: CellId[]): Set<string> => {
  return new Set(cells.map((cell) => `${cell.rowIndex}:${cell.targetId}`));
};

/**
 * Checks if a specific cell is in the execution set.
 */
export const isCellInExecution = (
  cellSet: Set<string>,
  rowIndex: number,
  targetId: string
): boolean => {
  return cellSet.has(`${rowIndex}:${targetId}`);
};

/**
 * Get the count of cells that will be executed.
 * This is useful for progress display.
 */
export const getExecutionCellCount = (params: ComputeExecutionCellsParams): number => {
  return computeExecutionCells(params).length;
};

/**
 * Get the row indices that will have at least one cell executed.
 * Useful for determining which rows to show as "loading".
 */
export const getExecutionRowIndices = (cells: CellId[]): Set<number> => {
  return new Set(cells.map((cell) => cell.rowIndex));
};

/**
 * Get the target IDs that will have at least one cell executed.
 * Useful for determining which target columns to show progress for.
 */
export const getExecutionTargetIds = (cells: CellId[]): Set<string> => {
  return new Set(cells.map((cell) => cell.targetId));
};

/**
 * Count cells for a specific target from the execution set.
 */
export const countCellsForTarget = (
  cellSet: Set<string>,
  targetId: string,
  maxRowIndex: number
): number => {
  let count = 0;
  for (let i = 0; i <= maxRowIndex; i++) {
    if (cellSet.has(`${i}:${targetId}`)) {
      count++;
    }
  }
  return count;
};

/**
 * Count completed cells for a target based on results.
 * A cell is completed if it has an output or error.
 */
export const countCompletedCellsForTarget = (
  cellSet: Set<string>,
  targetId: string,
  results: {
    targetOutputs: Record<string, unknown[]>;
    errors: Record<string, string[]>;
  },
  maxRowIndex: number
): number => {
  let count = 0;
  for (let i = 0; i <= maxRowIndex; i++) {
    if (cellSet.has(`${i}:${targetId}`)) {
      const hasOutput = results.targetOutputs[targetId]?.[i] !== undefined;
      const hasError = results.errors[targetId]?.[i] !== undefined;
      if (hasOutput || hasError) {
        count++;
      }
    }
  }
  return count;
};
