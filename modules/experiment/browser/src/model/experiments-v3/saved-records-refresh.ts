/**
 * A saved dataset's rows read again after the dataset changed elsewhere (a version restore, an
 * edit on the dataset page), laid under the edits this workbench has not synced yet.
 */
import type { SavedRecord } from "./types.ts";

/** The workbench's unsynced edits for one dataset: record id to changed cells, or a deletion. */
export type PendingRecordChanges = Record<string, Record<string, unknown>>;

/**
 * The fresh rows with every unsynced edit kept: a changed cell keeps its local value, a pending
 * deletion stays deleted, and a row the server lacks but this tab still edits stays, as it was
 * here. Every other row is the server's.
 */
export function refreshedSavedRecords({
  fresh,
  current,
  pending,
}: {
  fresh: SavedRecord[];
  current: SavedRecord[];
  pending: PendingRecordChanges | undefined;
}): SavedRecord[] {
  const changes = pending ?? {};
  const deleted = (id: string) => changes[id]?._delete === true;
  const freshIds = new Set(fresh.map((record) => record.id));
  const merged = fresh
    .filter((record) => !deleted(record.id))
    .map((record) => {
      const change = changes[record.id];
      return change ? { ...record, ...change } : record;
    });
  const unsyncedHere = current.filter(
    (record) => changes[record.id] && !deleted(record.id) && !freshIds.has(record.id),
  );
  return [...merged, ...unsyncedHere];
}

/** Whether the server's columns are the ones the workbench keys its rows by. */
export function sameColumnNames({
  serverColumns,
  workbenchColumns,
}: {
  serverColumns: readonly string[];
  workbenchColumns: readonly string[];
}): boolean {
  const server = new Set(serverColumns);
  return server.size === workbenchColumns.length && workbenchColumns.every((n) => server.has(n));
}
