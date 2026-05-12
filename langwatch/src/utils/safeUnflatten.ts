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
export function safeUnflatten(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    if (parts.length === 1) {
      if (DANGEROUS_KEYS.has(key)) continue;
      result[key] = value;
      continue;
    }
    let current = result;
    let skip = false;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (DANGEROUS_KEYS.has(part)) {
        skip = true;
        break;
      }
      if (
        !(part in current) ||
        typeof current[part] !== "object" ||
        current[part] === null ||
        Array.isArray(current[part])
      ) {
        current[part] = Object.create(null);
      }
      current = current[part] as Record<string, unknown>;
    }
    if (skip) continue;
    const leaf = parts[parts.length - 1]!;
    if (DANGEROUS_KEYS.has(leaf)) continue;
    current[leaf] = value;
  }
  return result;
}
