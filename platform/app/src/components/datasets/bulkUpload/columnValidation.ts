/**
 * Confirm-step column-name validation for the bulk-upload drawer.
 *
 * The normalize job binds each record key to its confirmed `name`
 * (`out[target.name] = …`), so a blank name produces an `""`-keyed column and
 * two columns sharing a name collapse onto one key — the second silently
 * overwrites the first in every row, and the persisted `columnTypes` no longer
 * matches the record keys. Neither the bare `z.string()` name schema nor the
 * normalize binder (keyed on the unique `sourceHeader`) catches that, so the UI
 * must flag it and block the upload before the corruption is written.
 *
 * Kept pure + standalone so the rule is unit-testable and shared by the per-row
 * highlight and the global upload gate.
 */
import type { DatasetConfirmColumns } from "~/server/datasets/types";

/**
 * The `sourceHeader`s of every column whose `name` is invalid — blank (empty or
 * whitespace-only) or duplicated by another column. Duplicates are detected on
 * the raw `name` (the exact key normalize writes), so two columns differing only
 * in surrounding whitespace are distinct keys and not flagged. Empty is the
 * trimmed-empty case (a whitespace name is junk, never a real column).
 */
export function invalidColumnNameKeys(
  columns: DatasetConfirmColumns,
): Set<string> {
  const nameCounts = new Map<string, number>();
  for (const column of columns) {
    nameCounts.set(column.name, (nameCounts.get(column.name) ?? 0) + 1);
  }
  const invalid = new Set<string>();
  for (const column of columns) {
    if (column.name.trim() === "" || (nameCounts.get(column.name) ?? 0) > 1) {
      invalid.add(column.sourceHeader);
    }
  }
  return invalid;
}
