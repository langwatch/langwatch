import { otlpKeyValueSchema, type OtlpAnyValue } from "./any-value.ts";

/**
 * The one value an `AnyValue` carries, read in oneof field order — the schema doesn't enforce
 * exclusivity, so order decides a payload setting more than one field, matching the collector.
 * `{low, high}` reassembles as a signed 64-bit int with `low` masked to 32 bits before the OR,
 * since it arrives signed and a `low` above 2^31 would otherwise corrupt the high half.
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
 * Flattens one `AnyValue` into `output`, keyed by its dotted path — `.` separates both kvlist
 * keys and array indices, so `{ a: { b: [1, 2] } }` becomes `a.b.0` and `a.b.1`. An array whose
 * items are all scalars never reaches this branch: {@link otlpScalarValue} already turns it into
 * one JSON string, so only a MIXED array — objects among the scalars — is indexed out here.
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
    else if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          result[key] = JSON.stringify(JSON.parse(trimmed));
          continue;
        } catch {
          // Keep malformed JSON as the sender supplied it.
        }
      }
      result[key] = value;
    } else if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}
