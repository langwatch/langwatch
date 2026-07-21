import type {
  OtlpAnyValue,
  OtlpKeyValue,
} from "../../trace-processing/schemas/otlp";
import { compareOrdinal } from "../../../utils/compareOrdinal";
import { integerDecimal } from "./numbers";
import {
  isRecord,
  stableStringify,
  type UnknownRecord,
} from "./serialization";

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
              Object.entries(value.bytesValue as UnknownRecord)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, byte]) => Number(byte)),
            );
    return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
  }
  if (value.arrayValue && isRecord(value.arrayValue)) {
    const values = Array.isArray(value.arrayValue.values)
      ? value.arrayValue.values
      : [];
    return {
      type: "array",
      value: values.map((item) => canonicalAnyValue(item as OtlpAnyValue)),
    };
  }
  if (value.kvlistValue && isRecord(value.kvlistValue)) {
    const values = Array.isArray(value.kvlistValue.values)
      ? (value.kvlistValue.values as OtlpKeyValue[])
      : [];
    return { type: "kvlist", value: canonicalAttributes(values) };
  }
  return { type: "empty" };
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
