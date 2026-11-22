import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { nowInstant } from "@langwatch/time";
/**
 * Per-instance state for the standalone dataset editor (DatasetEditorTable). One editor = one
 * dataset.
 */
import { createStore, type StoreApi } from "zustand";

import type {
  AutosaveState,
  CellPosition,
  RowHeightMode,
} from "../model/dataset-table-context.tsx";
import type { PendingSavedChanges } from "../model/pending-saved-changes.ts";

export type EditorColumn = {
  id: string;
  name: string;
  type: DatasetColumnType;
};

export type EditorRecord = { id: string } & Record<string, string>;

/**
 * Maps records onto a new column set after a column edit. Values follow column names; a pure
 * in-place rename (same column count, the old name gone, the new name fresh at the same
 * position) carries values over by position.
 */
export function rekeyEditorRecords(
  records: EditorRecord[],
  prevColumns: EditorColumn[],
  nextColumns: { name: string }[],
): EditorRecord[] {
  const prevNames = prevColumns.map((c) => c.name);
  const nextNames = nextColumns.map((c) => c.name);
  const renamedByNewName = new Map<string, string>();
  if (prevNames.length === nextNames.length) {
    for (let i = 0; i < nextNames.length; i++) {
      const prevName = prevNames[i]!;
      const nextName = nextNames[i]!;
      const isRename =
        prevName !== nextName && !nextNames.includes(prevName) && !prevNames.includes(nextName);
      if (isRename) renamedByNewName.set(nextName, prevName);
    }
  }
  return records.map((record) => {
    const next: EditorRecord = { id: record.id };
    for (const name of nextNames) {
      const value = record[renamedByNewName.get(name) ?? name];
      if (value !== undefined) {
        next[name] = value;
      }
    }
    return next;
  });
}

let newRecordSeq = 0;
const generateRecordId = () => {
  newRecordSeq += 1;
  return `new_${nowInstant().epochMilliseconds}_${newRecordSeq}`;
};

export type DatasetEditorState = {
  /** Database dataset id: set in saved mode, undefined for in-memory. */
  dbDatasetId: string | undefined;
  columns: EditorColumn[];
  records: EditorRecord[];
  pendingSavedChanges: PendingSavedChanges;
  editingCell: CellPosition | undefined;
  selectedCell: CellPosition | undefined;
  selectedRows: Set<number>;
  expandedCells: Set<string>;
  rowHeightMode: RowHeightMode;
  autosave: { state: AutosaveState; error?: string };
};

export type DatasetEditorActions = {
  setData: (args: {
    columns: EditorColumn[];
    records: EditorRecord[];
    dbDatasetId?: string;
  }) => void;
  /** Display-sync upsert from an external writer (e.g. AI dataset
   *  generation) that persists records itself; bypasses the pending
   *  queue on purpose. Matches by record id; appends when absent. */
  upsertExternalRecord: (record: EditorRecord) => void;
  /** Display-sync removal counterpart to upsertExternalRecord. */
  removeExternalRecord: (recordId: string) => void;
  setCellValue: (args: { datasetId: string; row: number; columnId: string; value: string }) => void;
  addRow: () => number;
  deleteSelectedRows: () => void;
  setEditingCell: (cell: CellPosition | undefined) => void;
  setSelectedCell: (cell: CellPosition | undefined) => void;
  toggleRowSelection: (row: number) => void;
  selectAllRows: (rowCount: number) => void;
  clearRowSelection: () => void;
  toggleCellExpanded: (row: number, columnId: string) => void;
  setRowHeightMode: (mode: RowHeightMode) => void;
  clearPendingChange: (dbDatasetId: string, recordId: string) => void;
  setAutosave: (state: AutosaveState, error?: string) => void;
};

export type DatasetEditorStore = DatasetEditorState & DatasetEditorActions;

const emptyRecordFor = (columns: EditorColumn[]): EditorRecord => ({
  id: generateRecordId(),
  ...Object.fromEntries(columns.map((c) => [c.name, ""])),
});

/** Replaces the record with the same id, or appends it when absent. */
function upsertRecord(records: EditorRecord[], record: EditorRecord): EditorRecord[] {
  const index = records.findIndex((r) => r.id === record.id);
  if (index === -1) return [...records, record];
  return records.map((existing, i) => (i === index ? { ...existing, ...record } : existing));
}

/**
 * The records with one cell set. Typing into the trailing phantom row, or rows skipped
 * past it, materializes empty records up to the edited row.
 */
function recordsWithCellValue({
  records,
  columns,
  row,
  columnName,
  value,
}: {
  records: EditorRecord[];
  columns: EditorColumn[];
  row: number;
  columnName: string;
  value: string;
}): EditorRecord[] {
  const updatedRecords = [...records];
  while (updatedRecords.length <= row) {
    updatedRecords.push(emptyRecordFor(columns));
  }
  updatedRecords[row] = { ...updatedRecords[row]!, [columnName]: value };
  return updatedRecords;
}

function recordBody({ id: _id, ...body }: EditorRecord): Record<string, string> {
  return body;
}

/**
 * Saved mode queues the change for sync. New (padded) records queue their full body
 * so the sync creates them server-side too.
 */
function queueCellChange({
  datasetChanges: current,
  records,
  updatedRecords,
  row,
  columnName,
  value,
}: {
  datasetChanges: PendingSavedChanges[string] | undefined;
  records: EditorRecord[];
  updatedRecords: EditorRecord[];
  row: number;
  columnName: string;
  value: string;
}): PendingSavedChanges[string] {
  const datasetChanges = { ...current };
  const updatedRecord = updatedRecords[row]!;
  for (const padded of updatedRecords.slice(records.length)) {
    if (padded.id !== updatedRecord.id) datasetChanges[padded.id] = recordBody(padded);
  }
  datasetChanges[updatedRecord.id] =
    row >= records.length
      ? recordBody(updatedRecord)
      : { ...datasetChanges[updatedRecord.id], [columnName]: value };
  return datasetChanges;
}

function toggledIn<T>(values: Set<T>, value: T): Set<T> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/** Drops one record's pending change, and the dataset's entry once it holds none. */
function withoutPendingChange({
  pendingSavedChanges,
  dbDatasetId,
  recordId,
}: {
  pendingSavedChanges: PendingSavedChanges;
  dbDatasetId: string;
  recordId: string;
}): PendingSavedChanges {
  const { [dbDatasetId]: current, ...rest } = pendingSavedChanges;
  const { [recordId]: _removed, ...datasetChanges } = current ?? {};
  if (Object.keys(datasetChanges).length === 0) return rest;
  return { ...rest, [dbDatasetId]: datasetChanges };
}

export function createDatasetEditorStore(): StoreApi<DatasetEditorStore> {
  return createStore<DatasetEditorStore>((set, get) => ({
    dbDatasetId: undefined,
    columns: [],
    records: [],
    pendingSavedChanges: {},
    editingCell: undefined,
    selectedCell: undefined,
    selectedRows: new Set<number>(),
    expandedCells: new Set<string>(),
    rowHeightMode: "compact",
    autosave: { state: "idle" },

    setData: ({ columns, records, dbDatasetId }) => {
      set({
        columns,
        records,
        dbDatasetId,
        // Data swap invalidates row-indexed UI state
        selectedRows: new Set(),
        editingCell: undefined,
        selectedCell: undefined,
        expandedCells: new Set(),
      });
    },

    upsertExternalRecord: (record) => {
      set({ records: upsertRecord(get().records, record) });
    },

    removeExternalRecord: (recordId) => {
      set({ records: get().records.filter((r) => r.id !== recordId) });
    },

    setCellValue: ({ row, columnId, value }) => {
      const { columns, records, dbDatasetId, pendingSavedChanges } = get();
      const column = columns.find((c) => c.id === columnId);
      if (!column) return;

      const updatedRecords = recordsWithCellValue({
        records,
        columns,
        row,
        columnName: column.name,
        value,
      });
      if (!dbDatasetId) {
        set({ records: updatedRecords });
        return;
      }

      set({
        records: updatedRecords,
        pendingSavedChanges: {
          ...pendingSavedChanges,
          [dbDatasetId]: queueCellChange({
            datasetChanges: pendingSavedChanges[dbDatasetId],
            records,
            updatedRecords,
            row,
            columnName: column.name,
            value,
          }),
        },
      });
    },

    addRow: () => {
      const { columns, records } = get();
      const newRecord = emptyRecordFor(columns);
      set({ records: [...records, newRecord] });
      // New empty rows are not queued for sync: they only persist once a
      // cell gets a value (setCellValue queues them), mirroring the
      // trailing-phantom-row behavior.
      return records.length;
    },

    deleteSelectedRows: () => {
      const { records, selectedRows, dbDatasetId, pendingSavedChanges } = get();
      if (selectedRows.size === 0) return;

      const remaining = records.filter((_, idx) => !selectedRows.has(idx));
      const removed = records.filter((_, idx) => selectedRows.has(idx));

      if (!dbDatasetId) {
        set({
          records: remaining,
          selectedRows: new Set(),
          selectedCell: undefined,
          editingCell: undefined,
        });
        return;
      }

      const datasetChanges = { ...pendingSavedChanges[dbDatasetId] };
      for (const record of removed) {
        // Always queue a server deletion, overwriting any pending create or edit for the row.
        // The backend persists locally-added rows under their client-generated "new_" id, so
        // that prefix is not a reliable "never reached the server" signal: skipping the
        // deletion for those is what made deleted rows reappear on reload. A row that genuinely
        // never synced is a harmless no-op for deleteMany (it ignores unknown ids).
        datasetChanges[record.id] = { _delete: true };
      }

      set({
        records: remaining,
        selectedRows: new Set(),
        selectedCell: undefined,
        editingCell: undefined,
        pendingSavedChanges: { ...pendingSavedChanges, [dbDatasetId]: datasetChanges },
      });
    },

    setEditingCell: (cell) => set({ editingCell: cell }),
    setSelectedCell: (cell) => set({ selectedCell: cell }),

    toggleRowSelection: (row) => {
      set({ selectedRows: toggledIn(get().selectedRows, row) });
    },

    selectAllRows: (rowCount) => {
      set({
        selectedRows: new Set(Array.from({ length: rowCount }, (_, i) => i)),
      });
    },

    clearRowSelection: () => set({ selectedRows: new Set() }),

    toggleCellExpanded: (row, columnId) => {
      set({ expandedCells: toggledIn(get().expandedCells, `${row}-${columnId}`) });
    },

    setRowHeightMode: (mode) => set({ rowHeightMode: mode, expandedCells: new Set() }),

    clearPendingChange: (dbDatasetId, recordId) => {
      set({
        pendingSavedChanges: withoutPendingChange({
          pendingSavedChanges: get().pendingSavedChanges,
          dbDatasetId,
          recordId,
        }),
      });
    },

    setAutosave: (state, error) => set({ autosave: { state, error } }),
  }));
}
