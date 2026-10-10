import { nowInstant } from "@langwatch/time";
/** Reserved column names (id, selected) conflict with system fields or UI. */
export const RESERVED_COLUMN_NAMES = [
  "id", // Used as the primary key for dataset records
  "selected", // Used for row selection in the dataset grid UI
] satisfies readonly string[];

/**
 * Checks if a column name is reserved
 */
export function isReservedColumnName(columnName: string): boolean {
  return RESERVED_COLUMN_NAMES.includes(columnName.toLowerCase());
}

/**
 * Generates a safe column name that avoids reserved names and collisions with existing names
 * @param columnName - The original column name to make safe
 * @param existingNames - Set of existing column names to avoid collisions with
 * @returns A unique column name that is not reserved and doesn't collide with existing names
 */
export function getSafeColumnName(columnName: string, existingNames: Set<string>): string {
  // If the name is not reserved and doesn't exist, return as-is
  const isAvailable = !isReservedColumnName(columnName) && !existingNames.has(columnName);
  if (isAvailable) return columnName;

  // Generate a unique name by trying different suffixes
  let candidate = columnName;
  const suffix = "_";
  let counter = 0;

  for (;;) {
    const isTaken = isReservedColumnName(candidate) || existingNames.has(candidate);
    if (!isTaken) break;

    if (counter === 0) {
      candidate = `${columnName}${suffix}`;
    } else {
      candidate = `${columnName}_${counter}`;
    }
    counter++;

    // Safety check to prevent infinite loops (should never happen in practice)
    if (counter > 1000) {
      candidate = `${columnName}_${nowInstant().epochMilliseconds}`;
      break;
    }
  }

  return candidate;
}
