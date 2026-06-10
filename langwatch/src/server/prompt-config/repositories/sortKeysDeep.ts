/**
 * Recursively sort all object keys for deterministic JSON serialization.
 * Arrays preserve element order but their object elements get sorted keys.
 *
 * Lives in a neutral module so both the repository and the version schema can
 * import it without creating a repo↔schema import cycle.
 */
export function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return obj;
}
