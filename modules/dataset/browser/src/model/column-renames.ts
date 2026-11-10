import type { DatasetColumnRenames, DatasetRecordInput } from "@langwatch/dataset-contract";

/** A column being edited, with the stored column's name it was loaded as; a new one has none. */
export type SourcedColumn = { name: string; source?: string };

/** Each column marked with its own name as its source, as it is loaded for an edit. */
export const withSources = <Column extends { name: string }>(
  columns: Column[],
): (Column & { source: string })[] => columns.map((column) => ({ ...column, source: column.name }));

/** The renames an edit made: every loaded column whose name changed. */
export const columnRenamesOf = (columns: SourcedColumn[]): DatasetColumnRenames =>
  columns.flatMap((column) =>
    column.source !== undefined && column.source !== column.name
      ? [{ from: column.source, to: column.name }]
      : [],
  );

/** Records re-keyed to the edited columns, each value read from its column's source. */
export const recordsBySource = (
  records: DatasetRecordInput[],
  columns: SourcedColumn[],
): DatasetRecordInput[] =>
  records.map((record) => {
    const moved: DatasetRecordInput = record.id !== undefined ? { id: record.id } : {};
    for (const column of columns) {
      if (column.source !== undefined && column.source in record) {
        moved[column.name] = record[column.source];
      }
    }
    return moved;
  });
