/** Dedup names within batch (server only sees DB, not siblings).
 * Orchestrator retries on post-dedup collisions.
 */

/** Strip extension from filename for dataset name (fallback: whole name). */
export const baseNameFromFilename = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  // dot > 0 → strip the extension; dot === 0 → a dotfile (no stem) → empty;
  // dot < 0 → no extension, keep as-is.
  const withoutExtension = dot === 0 ? "" : filename;
  const stem = dot > 0 ? filename.slice(0, dot) : withoutExtension;
  const trimmed = stem.trim();
  return trimmed === "" ? "New Dataset" : trimmed;
};

/**
 * Increment a name's `" (k)"` suffix (or add `" (1)"`), for the next
 * candidate after a server slug 409 — a DB collision the within-batch
 * dedupe couldn't see (an existing dataset, or a concurrent create elsewhere).
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
 * One distinct name per input, preserving order: collisions get
 * `"<name> (1)"`, `"<name> (2)"`, … A literal matching an emitted suffix
 * keeps bumping: `["a","a","a (1)"]` → `["a","a (1)","a (1) (1)"]`.
 */
export const batchDedupeNames = (names: string[]): string[] => {
  const taken = new Set<string>();
  return names.map((name) => {
    const chosen = taken.has(name) ? nextSuffixed(name, taken) : name;
    taken.add(chosen);
    return chosen;
  });
};
