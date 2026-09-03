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

/**
 * The value types a caller can DECLARE for an editable scalar.
 *
 * Structural on purpose: the declaration itself belongs to whichever feature
 * owns the parameter (scenario parameters are the first), and this package sits
 * underneath every one of them. Spelling the three names here rather than
 * importing a feature's union is what keeps the arrow pointing the right way —
 * and a feature's own union is assignable to this one, so nothing casts.
 */
export type TypedScalarValueType = "string" | "number" | "boolean";

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
