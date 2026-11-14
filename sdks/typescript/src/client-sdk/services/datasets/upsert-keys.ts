import { DatasetValidationError } from "./errors";

/** A value as JSON with object keys sorted, so equal values compare equal whatever their order. */
export function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)))
      : inner,
  ) as string | undefined;
}

/** A key column's value as a comparable string, so 1 and "1" stay different keys. */
export function keyOf(value: unknown): string | undefined {
  return stableJson(value);
}

/**
 * Refuses, before any request, an entry whose key would not reach the wire (absent, undefined,
 * a function) and two entries that share a key, compared the way rows are matched.
 */
export function assertUpsertableKeys(entries: Record<string, unknown>[], key: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const value = Object.hasOwn(entry, key) ? keyOf(entry[key]) : undefined;
    if (value === undefined) {
      throw new DatasetValidationError(
        `Every entry must hold a JSON value in the key column "${key}"`,
        "missing_upsert_key",
      );
    }
    if (seen.has(value)) {
      throw new DatasetValidationError(
        `Two entries share the key ${key} = ${value}`,
        "duplicate_upsert_key",
      );
    }
    seen.add(value);
  }
}
