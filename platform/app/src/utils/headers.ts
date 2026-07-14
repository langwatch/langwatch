/**
 * Normalizes a header value that may be string or string[] to a single string.
 * Returns the first value if array, the string if string, or undefined.
 */
export function normalizeHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
