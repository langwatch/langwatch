/**
 * Utilities for detecting and skipping empty dataset rows.
 * Empty rows should be excluded from execution on both frontend and backend.
 */

/**
 * Internal/metadata field names that should be ignored when checking if a row is empty.
 * These are not actual data columns.
 */
const INTERNAL_FIELDS = new Set(["id", "selected"]);

/**
 * Check if a row is completely empty (all columns have empty or whitespace-only values).
 */
export const isRowEmpty = (row: Record<string, unknown>): boolean => {
  // Get all values except internal fields (those starting with _ or in INTERNAL_FIELDS)
  const values = Object.entries(row)
    .filter(([key]) => !key.startsWith("_") && !INTERNAL_FIELDS.has(key))
    .map(([, value]) => value);

  // If no values, it's empty
  if (values.length === 0) {
    return true;
  }

  // Check if all values are empty/null/undefined/whitespace-only
  return values.every((value) => {
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === "string") {
      return value.trim() === "";
    }
    // For non-string values, only null/undefined count as empty
    return false;
  });
};

/**
 * Get indices of non-empty rows from a dataset.
 */
export const getNonEmptyRowIndices = (rows: Record<string, unknown>[]): number[] => {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isRowEmpty(row))
    .map(({ index }) => index);
};

/**
 * Filter out empty rows from a dataset, returning both filtered rows and their original indices.
 */
export const filterEmptyRows = <T extends Record<string, unknown>>(
  rows: T[]
): { row: T; originalIndex: number }[] => {
  return rows
    .map((row, index) => ({ row, originalIndex: index }))
    .filter(({ row }) => !isRowEmpty(row));
};

/**
 * Count the number of non-empty rows in a dataset.
 */
export const countNonEmptyRows = (rows: Record<string, unknown>[]): number => {
  return rows.filter((row) => !isRowEmpty(row)).length;
};
