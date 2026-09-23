/**
 * Stringify a dataset value for display/transport: objects become JSON,
 * primitives pass through.
 */
export function datasetValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
