/**
 * Shared safe unflatten utility.
 *
 * Converts flat dot-notation keys into nested objects with prototype pollution
 * protection via DANGEROUS_KEYS blocklist and Object.create(null) intermediate
 * nodes.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Walks (creating as needed) the intermediate nodes named by every part but the
 * last, returning the node the leaf belongs on — or `null` when a part is a
 * blocked key, which drops the whole entry.
 */
function ensureContainerPath({
  root,
  parts,
}: {
  root: Record<string, unknown>;
  parts: string[];
}): Record<string, unknown> | null {
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (DANGEROUS_KEYS.has(part)) {
      return null;
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
  return current;
}

function assignFlatEntry({
  root,
  key,
  value,
}: {
  root: Record<string, unknown>;
  key: string;
  value: unknown;
}): void {
  const parts = key.split(".");
  if (parts.length === 1) {
    if (DANGEROUS_KEYS.has(key)) return;
    root[key] = value;
    return;
  }
  const current = ensureContainerPath({ root, parts });
  if (!current) return;
  const leaf = parts[parts.length - 1]!;
  if (DANGEROUS_KEYS.has(leaf)) return;
  current[leaf] = value;
}

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
    assignFlatEntry({ root: result, key, value });
  }
  return result;
}
