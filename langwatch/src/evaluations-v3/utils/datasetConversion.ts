import type { DatasetColumn } from "../types";

/**
 * Utility to filter out completely empty rows from dataset records.
 * A row is considered empty if ALL column values are empty strings or undefined.
 */
export const filterEmptyRows = (
  datasetRecords: Array<{ id: string } & Record<string, string>>,
  columnNames: string[],
): Array<{ id: string } & Record<string, string>> => {
  return datasetRecords.filter((row) => {
    // Check if at least one column has a non-empty value
    return columnNames.some((colName) => {
      const value = row[colName];
      return value !== undefined && value !== "";
    });
  });
};

/**
 * Converts column-based inline records to row-based records for saving.
 * Filters out completely empty rows.
 */
export const convertInlineToRowRecords = (
  columns: DatasetColumn[],
  records: Record<string, string[]>,
): Array<{ id: string } & Record<string, string>> => {
  const rowCount = Math.max(
    ...Object.values(records).map((arr) => arr.length),
    0,
  );

  const datasetRecords: Array<{ id: string } & Record<string, string>> = [];

  for (let i = 0; i < rowCount; i++) {
    const row: { id: string } & Record<string, string> = { id: `row_${i}` };
    for (const col of columns) {
      row[col.name] = records[col.id]?.[i] ?? "";
    }
    datasetRecords.push(row);
  }

  // Filter out empty rows
  const columnNames = columns.map((col) => col.name);
  return filterEmptyRows(datasetRecords, columnNames);
};
