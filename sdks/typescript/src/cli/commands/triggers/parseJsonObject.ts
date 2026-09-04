/**
 * Parses a flag value that must be a JSON OBJECT.
 *
 * `JSON.parse` is too permissive for a payload field: `JSON.parse("5")` and
 * `JSON.parse("[1]")` both succeed, and a TypeScript assertion on the result
 * has no runtime effect — so an array or a primitive would reach the API as
 * `filters` or `actionParams` and corrupt the request. Shared by the create
 * and update commands, which take the same two flags and owe them the same
 * contract.
 */
export function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not a JSON object");
  }
  return parsed as Record<string, unknown>;
}
