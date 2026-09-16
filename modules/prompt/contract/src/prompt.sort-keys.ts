/**
 * Recursively sorts object keys for deterministic JSON serialization; arrays
 * keep element order but sort each object element's keys. Lives in a neutral
 * module so the repository and version schema can both import it, avoiding a cycle.
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
