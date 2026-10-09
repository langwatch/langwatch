/**
 * Converts flat dot-notation keys into nested objects, guarding against
 * prototype pollution via the DANGEROUS_KEYS blocklist.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Unflatten flat dot-notation keys to nested objects with prototype pollution
 * protection via Object.create(null) and DANGEROUS_KEYS blocklist.
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
    const current = visitParentContainers(result, parts);
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
function visitParentContainers(
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
