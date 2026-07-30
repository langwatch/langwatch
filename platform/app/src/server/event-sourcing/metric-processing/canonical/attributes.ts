import { integerDecimal } from "./numbers";
import { compareOrdinal } from "./ordinal";
import type { OtlpAnyValue, OtlpKeyValue } from "./otlpTypes";
import { isRecord, stableStringify, type UnknownRecord } from "./serialization";

/**
 * Renders one OTLP `AnyValue` into a tagged, JSON-stable shape. Every variant
 * is a `{ type, value }` pair rather than a bare scalar, so `0`, `false` and
 * `""` all round-trip as themselves — nothing here collapses toward "empty"
 * just because the value happens to be falsy.
 */
export function canonicalAnyValue(
  value: OtlpAnyValue | UnknownRecord | undefined,
): unknown {
  if (!value) return { type: "empty" };
  if (value.stringValue !== undefined && value.stringValue !== null) {
    return { type: "string", value: value.stringValue };
  }
  if (value.boolValue !== undefined && value.boolValue !== null) {
    return {
      type: "bool",
      value:
        typeof value.boolValue === "string"
          ? value.boolValue.toLowerCase() === "true"
          : value.boolValue,
    };
  }
  if (value.intValue !== undefined && value.intValue !== null) {
    return {
      type: "int",
      value: integerDecimal(value.intValue, { signed: true }),
    };
  }
  if (value.doubleValue !== undefined && value.doubleValue !== null) {
    const number = Number(value.doubleValue);
    return {
      type: "double",
      value: Number.isFinite(number) ? number : String(value.doubleValue),
    };
  }
  if (value.bytesValue !== undefined && value.bytesValue !== null) {
    const bytes =
      value.bytesValue instanceof Uint8Array
        ? value.bytesValue
        : typeof value.bytesValue === "string"
          ? Buffer.from(value.bytesValue, "base64")
          : Buffer.from(
              Object.entries(value.bytesValue)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, byte]) => Number(byte)),
            );
    return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
  }
  if (value.arrayValue && isRecord(value.arrayValue)) {
    const items = Array.isArray(value.arrayValue.values)
      ? value.arrayValue.values
      : [];
    return {
      type: "array",
      value: items.map((item) => canonicalAnyValue(item as OtlpAnyValue)),
    };
  }
  if (value.kvlistValue && isRecord(value.kvlistValue)) {
    const items = Array.isArray(value.kvlistValue.values)
      ? (value.kvlistValue.values as OtlpKeyValue[])
      : [];
    return { type: "kvlist", value: canonicalAttributes(items) };
  }
  return { type: "empty" };
}

/**
 * Flatten a canonical KeyValue array — the shape {@link canonicalAttributes}
 * produces and `pointAttributesJson` stores — back into a scalar record.
 * Ints stay as their decimal strings; structured values (bytes, arrays,
 * kvlists) stay behind: fact-lifting consumers only ever key off scalars.
 */
export function scalarsFromCanonicalAttributes(
  attributes: unknown,
): Record<string, string | number | boolean> {
  const scalars: Record<string, string | number | boolean> = {};
  if (!Array.isArray(attributes)) return scalars;
  for (const attribute of attributes) {
    if (!isRecord(attribute) || typeof attribute.key !== "string") continue;
    const wrapped = attribute.value;
    if (!isRecord(wrapped)) continue;
    switch (wrapped.type) {
      case "string":
      case "int":
        if (typeof wrapped.value === "string") {
          scalars[attribute.key] = wrapped.value;
        }
        break;
      case "bool":
        if (typeof wrapped.value === "boolean") {
          scalars[attribute.key] = wrapped.value;
        }
        break;
      case "double":
        if (typeof wrapped.value === "number") {
          scalars[attribute.key] = wrapped.value;
        }
        break;
      default:
        break;
    }
  }
  return scalars;
}

/**
 * Canonicalises an OTLP attribute list: malformed entries drop out, and the
 * survivors sort by key (ordinal, never locale-sensitive — two workers must
 * derive the same SeriesId) with the rendered value as a tie-break, so the
 * same attribute set always canonicalises identically regardless of the
 * order the sender happened to emit it in.
 */
export function canonicalAttributes(
  attributes: unknown,
): Array<{ key: string; value: unknown }> {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .filter(
      (attribute): attribute is OtlpKeyValue =>
        isRecord(attribute) &&
        typeof attribute.key === "string" &&
        isRecord(attribute.value),
    )
    .map((attribute) => ({
      key: attribute.key,
      value: canonicalAnyValue(attribute.value),
    }))
    .sort(
      (a, b) =>
        compareOrdinal(a.key, b.key) ||
        compareOrdinal(stableStringify(a.value), stableStringify(b.value)),
    );
}
