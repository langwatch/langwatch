/**
 * Reading a key back out of a result cell: the database's projection UDF
 * leaves the key in the column — the value itself for a single-key function,
 * a tuple for the one whose key is a pair.
 * @see specs/lwql/app-functions.feature
 */

/**
 * The key parts a cell carries — empty when it carries none: a null column, an
 * empty one, or one that is not a shape a key comes in. An empty string is not
 * a key, it is what a missing map lookup answers with.
 */
export function findAppFunctionKeyParts(cell: unknown): readonly string[] {
  if (typeof cell === "string") return cell === "" ? [] : [cell];
  if (!Array.isArray(cell)) return [];
  if (cell.length === 0) return [];
  const parts = cell.map((part) => (typeof part === "string" ? part : ""));
  return parts.some((part) => part === "") ? [] : parts;
}

/**
 * The parts as one string, for use as a map key. JSON rather than a joined
 * separator: a separator that could occur inside a part would make two keys
 * collide, and a collision here is a wrong answer rather than an error.
 */
export function appFunctionKeyId(parts: readonly string[]): string {
  return JSON.stringify(parts);
}
