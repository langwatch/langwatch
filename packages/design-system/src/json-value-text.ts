/** Parse editable text as JSON, preserving invalid JSON as ordinary text. */
export function serializeValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Parse only JSON scalar values; objects, arrays and null remain text. */
export function serializeScalarValue(raw: string): string | number | boolean {
  const parsed = serializeValue(raw);
  const isScalar =
    typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean";

  return isScalar ? parsed : raw;
}

/** Quote strings that would otherwise be parsed back as another JSON type. */
export function displayValue(value: unknown): string {
  if (typeof value !== "string") {
    return JSON.stringify(value) ?? "";
  }

  try {
    JSON.parse(value);
    return JSON.stringify(value);
  } catch {
    return value;
  }
}

/** An empty optional scalar input represents an absent value. */
export function serializeOptionalScalarValue(raw: string): string | number | boolean | undefined {
  return raw === "" ? void 0 : serializeScalarValue(raw);
}

export function displayOptionalValue(value: unknown): string {
  return value === void 0 ? "" : displayValue(value);
}

/** Types caller can declare for editable scalars; structural to avoid coupling with features. */
export type TypedScalarValueType = "string" | "number" | "boolean";

/** Parse input as declared type: strings, numbers, booleans. Invalid text stays text. */
export function serializeTypedScalarValue({
  raw,
  type,
}: {
  raw: string;
  type?: TypedScalarValueType;
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
  type?: TypedScalarValueType;
}): string | number | boolean | undefined {
  return raw === "" ? void 0 : serializeTypedScalarValue({ raw, type });
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
  type?: TypedScalarValueType;
}): string {
  if (type === "string" && typeof value === "string") return value;
  return displayOptionalValue(value);
}
