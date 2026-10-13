/**
 * The run metadata read the way the live `JSONExtract*` calls read `ifNull(Metadata, '{}')`, so a
 * memory read answers what the ClickHouse read would: a missing or malformed value reads as ''.
 */
export function parseRunMetadata(metadata: string | null): unknown {
  if (!metadata) return {};
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed;
  } catch {
    return {};
  }
}

/** The value at a JSON path, or undefined where a step is missing or not an object. */
function valueAt({ value, path }: { value: unknown; path: readonly string[] }): unknown {
  let current = value;
  for (const key of path) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = Object.entries(current).find(([name]) => name === key)?.[1];
  }
  return current;
}

/** `JSONExtractString`: the string at the path, or ''. */
export function jsonString(input: { value: unknown; path: readonly string[] }): string {
  const found = valueAt(input);
  return typeof found === "string" ? found : "";
}

/** `JSONExtractRaw`: the value at the path as JSON text, or '' when it is absent. */
export function jsonRaw(input: { value: unknown; path: readonly string[] }): string {
  const found = valueAt(input);
  return found === undefined ? "" : JSON.stringify(found);
}

/** `JSONExtractArrayRaw`: the array at the path, or none when it is absent or not an array. */
export function jsonArray(input: { value: unknown; path: readonly string[] }): readonly unknown[] {
  const found = valueAt(input);
  return Array.isArray(found) ? found : [];
}
