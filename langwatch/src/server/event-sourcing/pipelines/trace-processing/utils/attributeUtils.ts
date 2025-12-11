/**
 * Filters out undefined values from an attributes record.
 *
 * @param attrs - The attributes record to filter
 * @returns A new record with only defined values
 *
 * @example
 * ```typescript
 * const filtered = filterUndefinedAttributes({
 *   key1: "value",
 *   key2: undefined,
 *   key3: 123,
 * });
 * // Result: { key1: "value", key3: 123 }
 * ```
 */
export function filterUndefinedAttributes(
  attrs: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | string[] | number[] | boolean[]> {
  if (!attrs) return {};
  const result: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      result[key] = value as
        | string
        | number
        | boolean
        | string[]
        | number[]
        | boolean[];
    }
  }
  return result;
}

