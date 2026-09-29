/**
 * LangWatchQL app functions — reading a key back out of a result cell.
 *
 * The database's projection UDF leaves the key in the column: the value itself
 * for a single-key function, a `Tuple` for the one whose key is a pair. So a
 * cell arrives as a string, as an array of strings, or as `null`, and this
 * module is the one place that decides which of those counts as a key.
 *
 * An empty string is deliberately **not** a key. It is what a missing map
 * lookup answers with (`Attributes['gen_ai.conversation.id']` on a trace that
 * carries no conversation id is the empty string, not null), and resolving it
 * would mean asking the trace store for "the thread named nothing" once per
 * such row.
 *
 * @see ./hydrate.ts
 */

/**
 * The key parts a cell carries, or `null` when it carries no key.
 *
 * `null` covers all three of "the column was null", "the column was empty" and
 * "the column was not a shape a key comes in" — the caller treats them
 * identically, hydrating the cell to `null` without asking the store anything.
 * A pair with one empty half is not half a key either: both parts have to be
 * there for the value to mean anything.
 */
export function appFunctionKeyParts(cell: unknown): readonly string[] | null {
  if (typeof cell === "string") return cell === "" ? null : [cell];
  if (!Array.isArray(cell)) return null;
  if (cell.length === 0) return null;
  const parts = cell.map((part) => (typeof part === "string" ? part : ""));
  return parts.some((part) => part === "") ? null : parts;
}

/**
 * The parts as one string, for use as a map key.
 *
 * JSON rather than a joined separator: trace and span ids are hex today, but a
 * separator that could occur inside a part would make two different keys
 * collide, and a collision here is a wrong answer rather than an error. JSON
 * escapes whatever it has to.
 */
export function appFunctionKeyId(parts: readonly string[]): string {
  return JSON.stringify(parts);
}
