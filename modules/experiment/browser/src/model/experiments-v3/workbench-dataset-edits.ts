/**
 * Pure edits of the workbench's datasets: inline columns, cell reads, and the
 * saved-record changes queued for the database. The store applies them.
 */
import { nowInstant } from "@langwatch/time";

import type { DatasetColumn, DatasetReference, EvaluationsV3State } from "./types.ts";

type DatasetsEdit = Pick<EvaluationsV3State, "datasets"> | EvaluationsV3State;

/** An inline dataset's columns (both lists) with one column changed by `edit`. */
export const withInlineColumnEdit = ({
  state,
  datasetId,
  columnId,
  edit,
}: {
  state: EvaluationsV3State;
  datasetId: string;
  columnId: string;
  edit: (column: DatasetColumn) => DatasetColumn;
}): DatasetsEdit => {
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (dataset?.type !== "inline" || !dataset.inline) return state;
  const inline = dataset.inline;
  const updateColumns = (cols: DatasetColumn[]) =>
    cols.map((c) => (c.id === columnId ? edit(c) : c));

  return {
    datasets: state.datasets.map((d) =>
      d.id === datasetId
        ? {
            ...d,
            columns: updateColumns(d.columns),
            inline: { ...inline, columns: updateColumns(inline.columns) },
          }
        : d,
    ),
  };
};

/** An inline dataset without one column and its values. */
export const withoutInlineColumn = ({
  state,
  datasetId,
  columnId,
}: {
  state: EvaluationsV3State;
  datasetId: string;
  columnId: string;
}): DatasetsEdit => {
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (dataset?.type !== "inline" || !dataset.inline) return state;
  const inline = dataset.inline;
  const records = { ...inline.records };
  delete records[columnId];

  return {
    datasets: state.datasets.map((d) =>
      d.id === datasetId
        ? {
            ...d,
            columns: d.columns.filter((c) => c.id !== columnId),
            inline: {
              ...inline,
              columns: inline.columns.filter((c) => c.id !== columnId),
              records,
            },
          }
        : d,
    ),
  };
};

/** Rows in an inline dataset (its longest column) or a saved one's cached records. */
export const datasetRowCount = (dataset: DatasetReference | undefined): number => {
  if (dataset?.type === "inline" && dataset.inline) {
    const columnValues = Object.values(dataset.inline.records);
    return columnValues.length === 0 ? 0 : Math.max(...columnValues.map((v) => v.length));
  }
  if (dataset?.type === "saved" && dataset.savedRecords) return dataset.savedRecords.length;
  return 0;
};

/** One cell as text: saved records are keyed by column name, and objects stringify as JSON. */
export const datasetCellValue = ({
  dataset,
  row,
  columnId,
}: {
  dataset: DatasetReference | undefined;
  row: number;
  columnId: string;
}): string => {
  if (dataset?.type === "inline" && dataset.inline) {
    return dataset.inline.records[columnId]?.[row] ?? "";
  }
  if (dataset?.type !== "saved" || !dataset.savedRecords) return "";
  const record = dataset.savedRecords[row];
  const column = dataset.columns.find((c) => c.id === columnId);
  if (!record || !column) return "";
  const value = record[column.name];
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
};

const emptyRecordValues = (columns: DatasetColumn[]): Record<string, string> =>
  Object.fromEntries(columns.map((c) => [c.name, ""]));

/**
 * One saved-dataset cell edited, and queued for the database. A row past the
 * cached records becomes a new record (padding any gap) under a temporary id
 * the sync replaces.
 */
export const withSavedRecordEdit = ({
  state,
  datasetId,
  rowIndex,
  columnId,
  value,
}: {
  state: EvaluationsV3State;
  datasetId: string;
  rowIndex: number;
  columnId: string;
  value: string;
}): Partial<EvaluationsV3State> => {
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (dataset?.type !== "saved" || !dataset.datasetId) return state;
  const column = dataset.columns.find((c) => c.id === columnId);
  if (!column) return state;

  const dbDatasetId = dataset.datasetId;
  const updatedRecords = [...(dataset.savedRecords ?? [])];
  const existing = updatedRecords[rowIndex];
  const datasetChanges = state.pendingSavedChanges[dbDatasetId] ?? {};
  let queued: Record<string, Record<string, unknown>>;

  if (existing) {
    updatedRecords[rowIndex] = { ...existing, [column.name]: value };
    queued = {
      ...datasetChanges,
      [existing.id]: { ...datasetChanges[existing.id], [column.name]: value },
    };
  } else {
    const newRecord = {
      id: `new_${nowInstant().epochMilliseconds}_${rowIndex}`,
      ...emptyRecordValues(dataset.columns),
      [column.name]: value,
    };
    while (updatedRecords.length < rowIndex) {
      updatedRecords.push({
        id: `new_${nowInstant().epochMilliseconds}_${updatedRecords.length}`,
        ...emptyRecordValues(dataset.columns),
      });
    }
    updatedRecords[rowIndex] = newRecord;
    queued = { ...datasetChanges, [newRecord.id]: newRecord };
  }

  return {
    datasets: state.datasets.map((d) =>
      d.id === datasetId ? { ...d, savedRecords: updatedRecords } : d,
    ),
    pendingSavedChanges: { ...state.pendingSavedChanges, [dbDatasetId]: queued },
  };
};

/** The pending changes without one record's, dropping an emptied dataset entry. */
export const withoutPendingChange = ({
  pending,
  dbDatasetId,
  recordId,
}: {
  pending: EvaluationsV3State["pendingSavedChanges"];
  dbDatasetId: string;
  recordId: string;
}): EvaluationsV3State["pendingSavedChanges"] => {
  const next = { ...pending };
  const datasetChanges = { ...next[dbDatasetId] };
  delete datasetChanges[recordId];
  if (Object.keys(datasetChanges).length === 0) {
    delete next[dbDatasetId];
  } else {
    next[dbDatasetId] = datasetChanges;
  }
  return next;
};

const clearedRowSelection = (ui: EvaluationsV3State["ui"]): EvaluationsV3State["ui"] => ({
  ...ui,
  selectedRows: new Set(),
  // Selection and editing must not point at a deleted row.
  selectedCell: undefined,
  editingCell: undefined,
});

/**
 * A dataset without the selected rows. Inline data keeps one empty row so the
 * table always has a line to type into; a saved dataset queues its persisted
 * records (not the unsynced `new_` ones) as `{ _delete: true }` changes.
 */
export const withoutSelectedRows = ({
  state,
  datasetId,
  rows,
}: {
  state: EvaluationsV3State;
  datasetId: string;
  rows: Set<number>;
}): Partial<EvaluationsV3State> => {
  const dataset = state.datasets.find((d) => d.id === datasetId);
  const kept = (_: unknown, index: number) => !rows.has(index);

  if (dataset?.type === "inline" && dataset.inline) {
    const inline = dataset.inline;
    const entries = Object.entries(inline.records).map(
      ([columnId, values]) => [columnId, values.filter(kept)] as const,
    );
    const isEmpty = (entries[0]?.[1].length ?? 0) === 0;
    const records = Object.fromEntries(
      entries.map(([columnId, values]) => [columnId, isEmpty ? [""] : values]),
    );
    return {
      datasets: state.datasets.map((d) =>
        d.id === datasetId ? { ...d, inline: { ...inline, records } } : d,
      ),
      ui: clearedRowSelection(state.ui),
    };
  }

  if (dataset?.type !== "saved" || !dataset.savedRecords) return state;

  const deletedIds = dataset.savedRecords
    .filter((_, index) => rows.has(index))
    .map((record) => record.id)
    .filter((id) => !id.startsWith("new_"));
  const dbDatasetId = dataset.datasetId;
  const pendingSavedChanges =
    dbDatasetId && deletedIds.length > 0
      ? {
          ...state.pendingSavedChanges,
          [dbDatasetId]: {
            ...state.pendingSavedChanges[dbDatasetId],
            ...Object.fromEntries(deletedIds.map((id) => [id, { _delete: true }])),
          },
        }
      : state.pendingSavedChanges;

  return {
    datasets: state.datasets.map((d) =>
      d.id === datasetId ? { ...d, savedRecords: dataset.savedRecords?.filter(kept) } : d,
    ),
    pendingSavedChanges,
    ui: clearedRowSelection(state.ui),
  };
};
