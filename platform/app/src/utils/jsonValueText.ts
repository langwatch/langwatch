/**
 * Text <-> JSON value round-tripping for key/value inputs.
 *
 * Shared by every form that edits values which are also written over
 * REST/tRPC/SDK as real JSON: prompt runtime parameters and scenario parameter
 * definitions. Both need the same rule, so both read it from here.
 */

/**
 * Parse the text in a value input back into a JSON value.
 *
 * The text is interpreted as JSON when it parses, otherwise it is kept as a
 * plain string. This is the exact inverse of {@link displayValue}: a string
 * that looks like another type is quoted on display, so it parses back to a
 * string here.
 */
export function serializeValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Parse the text in a value input back into a JSON scalar.
 *
 * Same rule as {@link serializeValue} for the fields that can only hold a
 * string, a number or a boolean: text that parses as anything else (an object,
 * an array, null) is not a value they can carry, so it stands for itself.
 */
export function serializeScalarValue(raw: string): string | number | boolean {
  const parsed = serializeValue(raw);
  return typeof parsed === "string" ||
    typeof parsed === "number" ||
    typeof parsed === "boolean"
    ? parsed
    : raw;
}

/**
 * Render a stored JSON value as editable text.
 *
 * Inverse of {@link serializeValue}: a string whose contents would otherwise
 * parse as another JSON type (e.g. "007", "true", "{}") is shown quoted so it
 * cannot be silently coerced on the next edit; plain strings are shown bare.
 */
export function displayValue(v: unknown): string {
  if (typeof v === "string") {
    try {
      JSON.parse(v);
      // Bare text would re-parse as a non-string → quote to disambiguate.
      return JSON.stringify(v);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v);
}
