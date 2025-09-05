/**
 * Reserved column names that cannot be used in datasets because they conflict
 * with system-generated fields or UI functionality.
 *
 * Single Responsibility: Centralize the definition of reserved column names to ensure consistency across dataset operations.
 */
export const RESERVED_COLUMN_NAMES = [
  "id", // Used as the primary key for dataset records
  "selected", // Used for row selection in the dataset grid UI
] as const;

/**
 * Checks if a column name is reserved
 */
export function isReservedColumnName(columnName: string): boolean {
  return RESERVED_COLUMN_NAMES.includes(columnName.toLowerCase() as any);
}

/**
 * Generates a safe column name that avoids reserved names and collisions with existing names
 * @param columnName - The original column name to make safe
 * @param existingNames - Set of existing column names to avoid collisions with
 * @returns A unique column name that is not reserved and doesn't collide with existing names
 */
export function getSafeColumnName(
  columnName: string,
  existingNames: Set<string>
): string {
  // If the name is not reserved and doesn't exist, return as-is
  if (!isReservedColumnName(columnName) && !existingNames.has(columnName)) {
    return columnName;
  }

  // Generate a unique name by trying different suffixes
  let candidate = columnName;
  let suffix = "_";
  let counter = 0;

  while (isReservedColumnName(candidate) || existingNames.has(candidate)) {
    if (counter === 0) {
      candidate = `${columnName}${suffix}`;
    } else {
      candidate = `${columnName}_${counter}`;
    }
    counter++;

    // Safety check to prevent infinite loops (should never happen in practice)
    if (counter > 1000) {
      candidate = `${columnName}_${Date.now()}`;
      break;
    }
  }

  return candidate;
}
