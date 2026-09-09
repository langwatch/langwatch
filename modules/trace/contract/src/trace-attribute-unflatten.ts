/**
 * Shared safe unflatten utility.
 *
 * Converts flat dot-notation keys into nested objects with prototype pollution
 * protection via DANGEROUS_KEYS blocklist and Object.create(null) intermediate
 * nodes.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Converts flat dot-notation keys into nested objects.
 *
 * Uses `Object.create(null)` for all objects (root and intermediate) to
 * eliminate prototype pollution vectors entirely. DANGEROUS_KEYS are also
 * blocked as a defence-in-depth measure.
 *
 * Leaf values (arrays, objects, scalars) are preserved as-is.
 *
 * @example
 * safeUnflatten({ "a.b.c": 1 }) // → { a: { b: { c: 1 } } }
 */
export function safeUnflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    if (parts.length === 1) {
      if (DANGEROUS_KEYS.has(key)) continue;
      result[key] = value;
      continue;
    }
    const current = descendToParent(result, parts);
    if (current === null) continue;
    const leaf = parts[parts.length - 1]!;
    if (DANGEROUS_KEYS.has(leaf)) continue;
    current[leaf] = value;
  }
  return result;
}

/**
 * Walks (creating as it goes) the containers the leaf hangs under, replacing anything
 * that is not a plain object. Null when a segment is one of the prototype-poisoning keys.
 */
function descendToParent(
  result: Record<string, unknown>,
  parts: string[],
): Record<string, unknown> | null {
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (DANGEROUS_KEYS.has(part)) return null;
    const existing = current[part];
    const holdsPlainObject =
      part in current &&
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing);
    if (!holdsPlainObject) {
      current[part] = Object.create(null);
    }
    current = current[part] as Record<string, unknown>;
  }

  return current;
}
