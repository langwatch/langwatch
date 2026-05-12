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

/**
 * Format a raw attribute value for display in a pin pill. Strings pass
 * through; primitives stringify; objects fall back to JSON.
 *
 * When `key` is provided, key-aware formatting kicks in for attributes
 * whose raw shape would otherwise read as noise:
 *  - `langwatch.labels` arrives as a JSON-encoded array (e.g.
 *    `["sample","prod"]`). Rendering the literal array bracket + quotes in
 *    a pill pollutes the strip; we unwrap to a `·`-separated list so the
 *    user sees the labels themselves.
 */
export function formatPinValue({
  key,
  value,
}: {
  value: unknown;
  key?: string;
}): string | null {
  if (value === undefined || value === null || value === "") return null;

  // Key-aware formatting goes first so it can return without falling
  // through to the generic JSON stringify path.
  if (key === "langwatch.labels") {
    return formatLabelsValue(value);
  }

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Labels arrive in two practical shapes:
 *   1. JSON-encoded array string: `'["sample","prod"]'`
 *   2. Already-decoded array of strings.
 *
 * Either way, render as `sample · prod` so the user sees the labels and
 * not the array literal. Falls back to the raw string when neither shape
 * applies (e.g. legacy traces that wrote a plain comma-separated string).
 */
function formatLabelsValue(value: unknown): string | null {
  let arr: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        arr = JSON.parse(trimmed);
      } catch {
        return value;
      }
    } else {
      return value;
    }
  }
  if (!Array.isArray(arr)) return null;
  const labels = arr
    .map((item) => (typeof item === "string" ? item : String(item)))
    .filter((s) => s.length > 0);
  if (labels.length === 0) return null;
  return labels.join(" · ");
}

export function resolveAttributeValue(
  source: Record<string, string> | Record<string, unknown>,
  key: string,
): string | null {
  if (key in source) {
    return formatPinValue({
      key,
      value: (source as Record<string, unknown>)[key],
    });
  }
  // Dot-path traversal as a fallback for nested objects.
  const parts = key.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return formatPinValue({ key, value: current });
}
