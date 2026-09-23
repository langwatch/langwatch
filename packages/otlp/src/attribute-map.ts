import { otlpKeyValueSchema, type OtlpAnyValue } from "./any-value.ts";

/**
 * Reads `AnyValue` in oneof field order — order decides a payload setting
 * more than one field, matching the collector. `low` is masked to 32 bits
 * before OR-ing into `high`, since it arrives signed and would else corrupt it.
 */
export function otlpScalarValue(
  value: OtlpAnyValue,
): string | boolean | number | Uint8Array | undefined {
  if (typeof value.stringValue === "string") return value.stringValue;
  if (value.boolValue !== undefined && value.boolValue !== null) {
    return typeof value.boolValue === "string"
      ? value.boolValue.toLowerCase() === "true"
      : value.boolValue;
  }
  if (value.intValue !== undefined && value.intValue !== null) {
    if (typeof value.intValue === "object") {
      return Number(
        (BigInt(value.intValue.high) << 32n) | (BigInt(value.intValue.low) & 0xffffffffn),
      );
    }
    return typeof value.intValue === "string"
      ? Number.parseInt(value.intValue, 10)
      : value.intValue;
  }
  if (value.doubleValue !== undefined && value.doubleValue !== null) {
    return typeof value.doubleValue === "string"
      ? Number.parseFloat(value.doubleValue)
      : value.doubleValue;
  }
  if (value.bytesValue instanceof Uint8Array) return value.bytesValue;
  if (typeof value.bytesValue === "string") return Buffer.from(value.bytesValue, "base64");
  if (
    value.arrayValue &&
    value.arrayValue.values.every((item) => otlpScalarValue(item) !== undefined)
  ) {
    return JSON.stringify(value.arrayValue.values.map((item) => otlpScalarValue(item)));
  }
  return undefined;
}

/**
 * Flattens one `AnyValue` into `output`, keyed by dotted path (`.` separates
 * kvlist keys and array indices). Only a MIXED array reaches here — a scalar
 * array already became one JSON string via {@link otlpScalarValue}.
 */
function flatten(value: OtlpAnyValue, prefix: string, output: Record<string, unknown>): void {
  const primitive = otlpScalarValue(value);
  if (primitive !== undefined) {
    output[prefix] = primitive;
    return;
  }
  if (value.kvlistValue) {
    for (const child of value.kvlistValue.values) {
      flatten(child.value, prefix ? `${prefix}.${child.key}` : child.key, output);
    }
    return;
  }
  if (value.arrayValue) {
    value.arrayValue.values.forEach((child, index) => flatten(child, `${prefix}.${index}`, output));
  }
}

/**
 * A JSON-shaped string re-serialised so the sender's whitespace does not reach
 * storage, or undefined when it is not JSON after all.
 */
function findNormalizedJson(value: string): string | undefined {
  const trimmed = value.trim();
  const shaped =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!shaped) return void 0;

  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return void 0;
  }
}

/**
 * An OTLP attribute array as a flat map of strings, one leaf per dotted path — flattened so a
 * column store can index an attribute by name without knowing its shape. JSON-looking strings
 * are re-serialised to normalise sender whitespace; malformed entries are skipped, not raised.
 */
export function normalizeOtlpAttributeMap(attributes: unknown): Record<string, string> {
  if (!Array.isArray(attributes)) return {};
  const flattened: Record<string, unknown> = {};
  for (const raw of attributes) {
    const entry = otlpKeyValueSchema.safeParse(raw);
    if (!entry.success) continue;
    flatten(entry.data.value, entry.data.key, flattened);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(flattened)) {
    if (value instanceof Uint8Array) result[key] = Buffer.from(value).toString("hex");
    else if (Array.isArray(value)) result[key] = JSON.stringify(value);
    else if (typeof value === "string") result[key] = findNormalizedJson(value) ?? value;
    else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
      result[key] = String(value);
    else if (value !== undefined && value !== null) result[key] = JSON.stringify(value);
  }
  return result;
}
