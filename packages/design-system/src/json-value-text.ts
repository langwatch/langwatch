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
    typeof parsed === "string" ||
    typeof parsed === "number" ||
    typeof parsed === "boolean";

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
export function serializeOptionalScalarValue(
  raw: string,
): string | number | boolean | undefined {
  return raw === "" ? void 0 : serializeScalarValue(raw);
}

export function displayOptionalValue(value: unknown): string {
  return value === void 0 ? "" : displayValue(value);
}
