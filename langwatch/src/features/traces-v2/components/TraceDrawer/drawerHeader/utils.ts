export function readNumberAttribute(
  attributes: Record<string, string>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const raw = attributes[key];
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function formatPinValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function resolveAttributeValue(
  source: Record<string, string> | Record<string, unknown>,
  key: string,
): string | null {
  if (key in source) {
    return formatPinValue((source as Record<string, unknown>)[key]);
  }
  // Dot-path traversal as a fallback for nested objects.
  const parts = key.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return formatPinValue(current);
}
