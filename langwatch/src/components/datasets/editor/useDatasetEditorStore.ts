/**
 * Per-instance state for the standalone dataset editor (DatasetEditorTable).
 *
 * One editor = one dataset. Records are full rows keyed by column NAME
 * (matching how dataset records are stored server-side); columns carry
 * generated ids (`${name}_${index}`) for stable TanStack column identity.
 *
 * In saved mode every mutation is mirrored into pendingSavedChanges, which
 * useDatasetRecordSync drains to the database. In in-memory mode the caller
 * subscribes to record changes and owns persistence.
 */
import { createStore, type StoreApi } from "zustand";

import type { DatasetColumnType } from "~/server/datasets/types";
import type {
  AutosaveState,
  CellPosition,
  RowHeightMode,
} from "./DatasetTableContext";
import type { PendingSavedChanges } from "./useDatasetRecordSync";

export type EditorColumn = {
  id: string;
  name: string;
  type: DatasetColumnType;
};

export type EditorRecord = { id: string } & Record<string, string>;

let newRecordSeq = 0;
const generateRecordId = () =>
  `new_${Date.now()}_${(newRecordSeq += 1)}`;

export type DatasetEditorState = {
  /** Database dataset id — set in saved mode, undefined for in-memory. */
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
  setCellValue: (
    datasetId: string,
    row: number,
    columnId: string,
    value: string,
  ) => void;
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

    setCellValue: (_datasetId, row, columnId, value) => {
      const { columns, records, dbDatasetId, pendingSavedChanges } = get();
      const column = columns.find((c) => c.id === columnId);
      if (!column) return;

      const updatedRecords = [...records];
      // Pad up to the edited row (typing into the trailing phantom row, or
      // rows skipped past it, materializes empty records)
      while (updatedRecords.length <= row) {
        updatedRecords.push(emptyRecordFor(columns));
      }
      const record = updatedRecords[row]!;
      const updatedRecord: EditorRecord = { ...record, [column.name]: value };
      updatedRecords[row] = updatedRecord;

      if (!dbDatasetId) {
        set({ records: updatedRecords });
        return;
      }

      // Saved mode: queue the change for sync. New (padded) records queue
      // their full body so the sync creates them server-side too.
      const datasetChanges = { ...(pendingSavedChanges[dbDatasetId] ?? {}) };
      for (let i = records.length; i < updatedRecords.length; i++) {
        const padded = updatedRecords[i]!;
        if (padded.id !== updatedRecord.id) {
          const { id: _id, ...body } = padded;
          datasetChanges[padded.id] = body;
        }
      }
      const isNewRecord = row >= records.length;
      datasetChanges[updatedRecord.id] = isNewRecord
        ? (() => {
            const { id: _id, ...body } = updatedRecord;
            return body;
          })()
        : {
            ...(datasetChanges[updatedRecord.id] ?? {}),
            [column.name]: value,
          };

      set({
        records: updatedRecords,
        pendingSavedChanges: {
          ...pendingSavedChanges,
          [dbDatasetId]: datasetChanges,
        },
      });
    },

    addRow: () => {
      const { columns, records } = get();
      const newRecord = emptyRecordFor(columns);
      set({ records: [...records, newRecord] });
      // New empty rows are not queued for sync — they only persist once a
      // cell gets a value (setCellValue queues them), mirroring the
      // trailing-phantom-row behavior.
      return records.length;
    },

    deleteSelectedRows: () => {
      const {
        records,
        selectedRows,
        dbDatasetId,
        pendingSavedChanges,
      } = get();
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

      const datasetChanges = { ...(pendingSavedChanges[dbDatasetId] ?? {}) };
      for (const record of removed) {
        if (record.id.startsWith("new_")) {
          // Never reached the server — just drop any queued create
          delete datasetChanges[record.id];
        } else {
          datasetChanges[record.id] = { _delete: true };
        }
      }

      set({
        records: remaining,
        selectedRows: new Set(),
        selectedCell: undefined,
        editingCell: undefined,
        pendingSavedChanges: {
          ...pendingSavedChanges,
          [dbDatasetId]: datasetChanges,
        },
      });
    },

    setEditingCell: (cell) => set({ editingCell: cell }),
    setSelectedCell: (cell) => set({ selectedCell: cell }),

    toggleRowSelection: (row) => {
      const selectedRows = new Set(get().selectedRows);
      if (selectedRows.has(row)) {
        selectedRows.delete(row);
      } else {
        selectedRows.add(row);
      }
      set({ selectedRows });
    },

    selectAllRows: (rowCount) => {
      set({
        selectedRows: new Set(Array.from({ length: rowCount }, (_, i) => i)),
      });
    },

    clearRowSelection: () => set({ selectedRows: new Set() }),

    toggleCellExpanded: (row, columnId) => {
      const key = `${row}-${columnId}`;
      const expandedCells = new Set(get().expandedCells);
      if (expandedCells.has(key)) {
        expandedCells.delete(key);
      } else {
        expandedCells.add(key);
      }
      set({ expandedCells });
    },

    setRowHeightMode: (mode) =>
      set({ rowHeightMode: mode, expandedCells: new Set() }),

    clearPendingChange: (dbDatasetId, recordId) => {
      const pendingSavedChanges = { ...get().pendingSavedChanges };
      const datasetChanges = { ...(pendingSavedChanges[dbDatasetId] ?? {}) };
      delete datasetChanges[recordId];
      if (Object.keys(datasetChanges).length === 0) {
        delete pendingSavedChanges[dbDatasetId];
      } else {
        pendingSavedChanges[dbDatasetId] = datasetChanges;
      }
      set({ pendingSavedChanges });
    },

    setAutosave: (state, error) => set({ autosave: { state, error } }),
  }));
}
