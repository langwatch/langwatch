/**
 * Text <-> JSON value round-tripping for key/value inputs.
 *
 * Shared by every form that edits values which are also written over
 * REST/tRPC/SDK as real JSON: prompt runtime parameters and scenario parameter
 * definitions. Both need the same rule, so both read it from here.
 */

import type { ScenarioParameterType } from "~/server/scenarios/parameters";

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
  // `JSON.stringify` answers with the value `undefined`, not with text, for
  // undefined, a function and a symbol. A parameter declared without a default
  // arrives here as undefined, and handing that back to an input's `value`
  // flips the field to uncontrolled on the next render.
  return JSON.stringify(v) ?? "";
}

/**
 * Parse an OPTIONAL value input: an empty box means the value is absent.
 *
 * The empty-string sentinel is the whole point. A scenario parameter with no
 * default and a run that leaves a name at its default are the same shape on
 * screen, an empty box, and both have to come back as `undefined` rather than
 * as the empty string, which is a value a run could legitimately supply.
 */
export function serializeOptionalScalarValue(
  raw: string,
): string | number | boolean | undefined {
  return raw === "" ? undefined : serializeScalarValue(raw);
}

/**
 * Render an optional stored value as editable text. Inverse of
 * {@link serializeOptionalScalarValue}: absent shows as an empty box.
 */
export function displayOptionalValue(v: unknown): string {
  return v === undefined ? "" : displayValue(v);
}

/**
 * Parse the text in a value input as the type its parameter declares.
 *
 * A declared type settles what the JSON rule has to guess: "007" stays the
 * text "007" for a string parameter, "5" becomes the number 5 for a number
 * parameter, and "true" becomes a boolean for a boolean one. Text that cannot
 * be read as the declared type stays text, and the server refuses it by name.
 * Without a declared type the JSON rule of {@link serializeScalarValue} runs.
 */
export function serializeTypedScalarValue({
  raw,
  type,
}: {
  raw: string;
  type?: ScenarioParameterType;
}): string | number | boolean {
  if (type === "string") return asDeclaredString(raw);
  if (type === "number") return asDeclaredNumber(raw);
  if (type === "boolean") return asDeclaredBoolean(raw);
  return serializeScalarValue(raw);
}

/** The text of a string parameter; a quoted one loses its quotes here. */
function asDeclaredString(raw: string): string {
  const parsed = serializeValue(raw);
  return typeof parsed === "string" ? parsed : raw;
}

/** The number a number parameter holds; the text itself when it is not one. */
function asDeclaredNumber(raw: string): string | number {
  const asNumber = Number(raw);
  return raw.trim() !== "" && Number.isFinite(asNumber) ? asNumber : raw;
}

/** The boolean a boolean parameter holds; the text itself when it is not one. */
function asDeclaredBoolean(raw: string): string | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** {@link serializeTypedScalarValue} for an optional input: empty is absent. */
export function serializeOptionalTypedScalarValue({
  raw,
  type,
}: {
  raw: string;
  type?: ScenarioParameterType;
}): string | number | boolean | undefined {
  return raw === "" ? undefined : serializeTypedScalarValue({ raw, type });
}

/**
 * Render an optional stored value as editable text, given its declared type.
 *
 * A string parameter shows its value bare, "007" rather than "\"007\"": the
 * type already says it is text, so nothing has to be quoted to keep it so.
 * Every other case reads as {@link displayOptionalValue}.
 */
export function displayTypedValue({
  value,
  type,
}: {
  value: unknown;
  type?: ScenarioParameterType;
}): string {
  if (type === "string" && typeof value === "string") return value;
  return displayOptionalValue(value);
}
