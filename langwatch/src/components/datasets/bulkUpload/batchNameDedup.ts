/**
 * Bulk upload (D5): make the proposed dataset names within ONE batch distinct
 * before any upload starts.
 *
 * The server's `findNextName` checks the DB, not the not-yet-created siblings in
 * the same drop, so dropping two `data.csv` would propose "data" for both and the
 * second `requestDirectUpload` would 409 on the slug. We dedupe within the batch
 * up front ("data", "data (1)", …); a DB collision that survives this (a name
 * already taken by an existing dataset, or a concurrent create) is handled
 * separately by retrying the create with the next suffix (the orchestrator's
 * 409 auto-retry).
 */

/** Strip the extension from a filename to seed the dataset name (matches the
 *  single-upload flow's `proposeValidName`). Falls back to the whole name. */
export const baseNameFromFilename = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  // dot > 0 → strip the extension; dot === 0 → a dotfile (no stem) → empty;
  // dot < 0 → no extension, keep as-is.
  const stem = dot > 0 ? filename.slice(0, dot) : dot === 0 ? "" : filename;
  const trimmed = stem.trim();
  return trimmed === "" ? "New Dataset" : trimmed;
};

/**
 * Increment a name's `" (k)"` suffix (or add `" (1)"`). Used by the orchestrator
 * to pick the next candidate after a server slug 409 (a DB collision that the
 * within-batch dedupe couldn't see — e.g. a name already taken by an existing
 * dataset, or a concurrent create in another tab).
 */
export const bumpName = (name: string): string => {
  const match = name.match(/^(.*) \((\d+)\)$/);
  if (match) return `${match[1]} (${Number(match[2]) + 1})`;
  return `${name} (1)`;
};

/** The next unused `"<name> (k)"` for k ≥ 1, given the names already taken. */
const nextSuffixed = (name: string, taken: Set<string>): string => {
  let k = 1;
  let candidate = `${name} (${k})`;
  while (taken.has(candidate)) {
    k += 1;
    candidate = `${name} (${k})`;
  }
  return candidate;
};

/**
 * Return one distinct name per input, preserving order. The first occurrence
 * keeps its name; later collisions get `"<name> (1)"`, `"<name> (2)"`, … A
 * literal input that equals an already-emitted suffix keeps bumping, so
 * `["a","a","a (1)"]` → `["a","a (1)","a (1) (1)"]` — never a duplicate.
 */
export const batchDedupeNames = (names: string[]): string[] => {
  const taken = new Set<string>();
  return names.map((name) => {
    const chosen = taken.has(name) ? nextSuffixed(name, taken) : name;
    taken.add(chosen);
    return chosen;
  });
};
