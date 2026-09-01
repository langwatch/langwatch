/**
 * Stringify a dataset value for display/transport: objects become JSON,
 * primitives pass through.
 */
export function datasetValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
