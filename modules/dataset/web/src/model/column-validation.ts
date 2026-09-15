/** Validate column names (blank or duplicate). Normalize binds by name, so
 * invalid names corrupt record keys.
 */
import type { DatasetConfirmColumns } from "@langwatch/dataset-contract";

/** sourceHeaders of invalid columns (blank or duplicate name). */
export function invalidColumnNameKeys(columns: DatasetConfirmColumns): Set<string> {
  const nameCounts = new Map<string, number>();
  for (const column of columns) {
    nameCounts.set(column.name, (nameCounts.get(column.name) ?? 0) + 1);
  }
  const invalid = new Set<string>();
  for (const column of columns) {
    const isBlank = column.name.trim() === "";
    const isDuplicate = (nameCounts.get(column.name) ?? 0) > 1;
    if (isBlank || isDuplicate) invalid.add(column.sourceHeader);
  }
  return invalid;
}
