import { compareOrdinal } from "@langwatch/eventing";
import { otlpAnyValueSchema, type OtlpAnyValue } from "@langwatch/otlp";

import { integerDecimal } from "./metric-numbers.rules.ts";
import { isRecord, stableStringify, type UnknownRecord } from "./metric-serialization.rules.ts";

type OtlpKeyValue = { key: string; value: OtlpAnyValue };

function canonicalBoolValue(value: boolean | string): boolean {
  return typeof value === "string" ? value.toLowerCase() === "true" : value;
}

function canonicalBytesValue(value: Uint8Array | string | Record<string, unknown>): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (typeof value === "string") return Buffer.from(value, "base64").toString("base64");
  return Buffer.from(
    Object.entries(value)
      .toSorted(([a], [b]) => Number(a) - Number(b))
      .map(([, byte]) => Number(byte)),
  ).toString("base64");
}

function canonicalArrayValue(value: { values: OtlpAnyValue[] }): unknown {
  return {
    type: "array",
    value: value.values.map((item) => canonicalAnyValue(item)),
  };
}

export function canonicalAnyValue(value: OtlpAnyValue | UnknownRecord | undefined): unknown {
  const parsed = otlpAnyValueSchema.safeParse(value);
  if (!parsed.success) return { type: "empty" };
  const typed = parsed.data;
  if (typed.stringValue !== undefined && typed.stringValue !== null) {
    return { type: "string", value: typed.stringValue };
  }
  if (typed.boolValue !== undefined && typed.boolValue !== null) {
    return {
      type: "bool",
      value: canonicalBoolValue(typed.boolValue),
    };
  }
  if (typed.intValue !== undefined && typed.intValue !== null) {
    return {
      type: "int",
      value: integerDecimal(typed.intValue, { signed: true }),
    };
  }
  if (typed.doubleValue !== undefined && typed.doubleValue !== null) {
    const number = Number(typed.doubleValue);
    return {
      type: "double",
      value: Number.isFinite(number) ? number : String(typed.doubleValue),
    };
  }
  if (typed.bytesValue !== undefined && typed.bytesValue !== null) {
    return { type: "bytes", value: canonicalBytesValue(typed.bytesValue) };
  }
  if (typed.arrayValue) {
    return canonicalArrayValue(typed.arrayValue);
  }
  if (typed.kvlistValue) {
    return { type: "kvlist", value: canonicalAttributes(typed.kvlistValue.values) };
  }
  return { type: "empty" };
}

export function canonicalAttributes(attributes: unknown): { key: string; value: unknown }[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .filter(
      (attribute): attribute is OtlpKeyValue =>
        isRecord(attribute) && typeof attribute.key === "string" && isRecord(attribute.value),
    )
    .map((attribute) => ({
      key: attribute.key,
      value: canonicalAnyValue(attribute.value),
    }))
    .toSorted(
      (a, b) =>
        compareOrdinal(a.key, b.key) ||
        compareOrdinal(stableStringify(a.value), stableStringify(b.value)),
    );
}
