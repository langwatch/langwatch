import type { DatasetColumn } from "../types";

/**
 * Type for dataset record with optional ID.
 * IDs are omitted when saving new datasets - the backend generates unique IDs with nanoid.
 * IDs are present when reading existing saved records.
 */
export type DatasetRowRecord = { id?: string } & Record<string, string>;

/**
 * Utility to filter out completely empty rows from dataset records.
 * A row is considered empty if ALL column values are empty strings or undefined.
 */
export const filterEmptyRows = (
  datasetRecords: DatasetRowRecord[],
  columnNames: string[],
): DatasetRowRecord[] => {
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
 *
 * NOTE: IDs are NOT included - the backend's createDatasetRecords will generate
 * unique IDs using nanoid(). This prevents unique constraint violations when
 * saving datasets with names that produce the same record IDs.
 */
export const convertInlineToRowRecords = (
  columns: DatasetColumn[],
  records: Record<string, string[]>,
): DatasetRowRecord[] => {
  const rowCount = Math.max(
    ...Object.values(records).map((arr) => arr.length),
    0,
  );

  const datasetRecords: DatasetRowRecord[] = [];

  for (let i = 0; i < rowCount; i++) {
    const row: DatasetRowRecord = {};
    for (const col of columns) {
      row[col.name] = records[col.id]?.[i] ?? "";
    }
    datasetRecords.push(row);
  }

  // Filter out empty rows
  const columnNames = columns.map((col) => col.name);
  return filterEmptyRows(datasetRecords, columnNames);
};
