import { compareOrdinal } from "../../../utils/compareOrdinal";
import type {
  OtlpAnyValue,
  OtlpKeyValue,
} from "../../trace-processing/schemas/otlp";
import { integerDecimal } from "./numbers";
import { isRecord, stableStringify, type UnknownRecord } from "./serialization";

function canonicalBoolValue(boolValue: unknown): boolean {
  return typeof boolValue === "string"
    ? boolValue.toLowerCase() === "true"
    : (boolValue as boolean);
}

function canonicalBytesValue(bytesValue: unknown): string {
  const bytes =
    bytesValue instanceof Uint8Array
      ? bytesValue
      : typeof bytesValue === "string"
        ? Buffer.from(bytesValue, "base64")
        : Buffer.from(
            Object.entries(bytesValue as UnknownRecord)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([, byte]) => Number(byte)),
          );
  return Buffer.from(bytes).toString("base64");
}

function canonicalDoubleValue(doubleValue: unknown): number | string {
  const number = Number(doubleValue);
  return Number.isFinite(number) ? number : String(doubleValue);
}

function canonicalArrayItems(arrayValue: UnknownRecord): unknown[] {
  const values = Array.isArray(arrayValue.values) ? arrayValue.values : [];
  return values.map((item) => canonicalAnyValue(item as OtlpAnyValue));
}

function canonicalKvlistItems(
  kvlistValue: UnknownRecord,
): Array<{ key: string; value: unknown }> {
  const values = Array.isArray(kvlistValue.values)
    ? (kvlistValue.values as OtlpKeyValue[])
    : [];
  return canonicalAttributes(values);
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function canonicalAnyValue(
  value: OtlpAnyValue | UnknownRecord | undefined,
): unknown {
  if (!value) return { type: "empty" };
  if (isPresent(value.stringValue)) {
    return { type: "string", value: value.stringValue };
  }
  if (isPresent(value.boolValue)) {
    return { type: "bool", value: canonicalBoolValue(value.boolValue) };
  }
  if (isPresent(value.intValue)) {
    return {
      type: "int",
      value: integerDecimal(value.intValue, { signed: true }),
    };
  }
  if (isPresent(value.doubleValue)) {
    return { type: "double", value: canonicalDoubleValue(value.doubleValue) };
  }
  if (isPresent(value.bytesValue)) {
    return { type: "bytes", value: canonicalBytesValue(value.bytesValue) };
  }
  if (isRecord(value.arrayValue)) {
    return { type: "array", value: canonicalArrayItems(value.arrayValue) };
  }
  if (isRecord(value.kvlistValue)) {
    return { type: "kvlist", value: canonicalKvlistItems(value.kvlistValue) };
  }
  return { type: "empty" };
}

function scalarFromWrappedValue(
  wrapped: UnknownRecord,
): string | number | boolean | undefined {
  switch (wrapped.type) {
    case "string":
    case "int":
      return typeof wrapped.value === "string" ? wrapped.value : undefined;
    case "bool":
      return typeof wrapped.value === "boolean" ? wrapped.value : undefined;
    case "double":
      return typeof wrapped.value === "number" ? wrapped.value : undefined;
    default:
      return undefined;
  }
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
    const scalar = scalarFromWrappedValue(wrapped);
    if (scalar !== undefined) scalars[attribute.key] = scalar;
  }
  return scalars;
}

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
