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
 * Generates a safe column name by appending "_" to reserved names
 */
export function getSafeColumnName(columnName: string): string {
  return isReservedColumnName(columnName) ? `${columnName}_` : columnName;
}
