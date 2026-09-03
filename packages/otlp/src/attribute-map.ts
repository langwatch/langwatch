import { otlpKeyValueSchema, type OtlpAnyValue } from "./any-value";

/**
 * The one value an `AnyValue` carries, read in the order OTLP declares its
 * `oneof`.
 *
 * The schema does not enforce exclusivity (see {@link otlpAnyValueSchema}), so
 * the order here is what decides a payload that sets more than one field. It
 * follows the `oneof` field order, which is also what the collector does.
 *
 * Each branch also converts:
 *
 *   - `{ low, high }` is reassembled as a signed 64-bit integer. `low` is
 *     masked to 32 bits before the OR because it is delivered signed, so a
 *     `low` above 2^31 arrives negative and would otherwise corrupt the high
 *     half.
 *   - base64 `bytesValue` becomes a `Buffer`, so a caller sees bytes whichever
 *     transport delivered them.
 *   - an array of scalars becomes its JSON — an attribute map's values are
 *     strings, and this is the only lossless spelling of a list in one.
 *
 * Returns `undefined` for a value with no scalar reading: an empty `AnyValue`,
 * a `kvlistValue`, or an `arrayValue` holding anything but scalars. Those are
 * the cases {@link normalizeOtlpAttributeMap} descends into rather than reads.
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
 * Flattens one `AnyValue` into `output`, keyed by its dotted path.
 *
 * A `kvlistValue` contributes its keys, an `arrayValue` its indices, and the
 * separator is `.` in both — so `{ a: { b: [1, 2] } }` becomes `a.b.0` and
 * `a.b.1`. A scalar terminates the walk.
 *
 * An array whose items are all scalars never reaches the array branch: it is a
 * scalar itself by {@link otlpScalarValue}, and lands as one JSON string. Only
 * a MIXED array — objects among the scalars — is indexed out.
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
 * An OTLP attribute array as a flat map of strings.
 *
 * This is the shape the log and metric ingestion paths store attributes in:
 * one string per leaf, addressed by its dotted path. Structure is flattened
 * rather than preserved, which is what lets a column store index an attribute
 * by name without knowing the shape ahead of time.
 *
 * The rules, in the order they apply per value:
 *
 *   - bytes are hex, matching how identifiers are spelled everywhere else;
 *   - a string that LOOKS like JSON — `{...}` or `[...]` after trimming — is
 *     re-serialised through `JSON.parse`/`JSON.stringify`, which normalises
 *     the sender's whitespace so two senders of the same object produce the
 *     same stored string. Malformed JSON is kept exactly as it arrived, since
 *     the alternative is discarding an attribute the customer sent;
 *   - everything else is `String(value)`.
 *
 * Anything that is not an array, and any entry that does not parse as a
 * `{ key, value }` pair, is skipped rather than raising: this runs on the
 * ingestion path, where one malformed attribute must not cost the whole batch.
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
