import { compareOrdinal } from "@langwatch/eventing";
import { otlpAnyValueSchema, type OtlpAnyValue } from "./otlp-attribute.rules";

type OtlpKeyValue = { key: string; value: OtlpAnyValue };
import { integerDecimal } from "./metric-numbers.rules";
import { isRecord, stableStringify, type UnknownRecord } from "./metric-serialization.rules";

function canonicalAnyValue(value: OtlpAnyValue | UnknownRecord | undefined): unknown {
  const parsed = otlpAnyValueSchema.safeParse(value);
  if (!parsed.success) return { type: "empty" };
  const typed = parsed.data;
  if (typed.stringValue !== undefined && typed.stringValue !== null) {
    return { type: "string", value: typed.stringValue };
  }
  if (typed.boolValue !== undefined && typed.boolValue !== null) {
    return {
      type: "bool",
      value:
        typeof typed.boolValue === "string"
          ? typed.boolValue.toLowerCase() === "true"
          : typed.boolValue,
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
    const bytes =
      typed.bytesValue instanceof Uint8Array
        ? typed.bytesValue
        : typeof typed.bytesValue === "string"
          ? Buffer.from(typed.bytesValue, "base64")
          : Buffer.from(
              Object.entries(typed.bytesValue)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([, byte]) => Number(byte)),
            );
    return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
  }
  if (typed.arrayValue) {
    const values = typed.arrayValue.values;
    return {
      type: "array",
      value: values.map((item) => canonicalAnyValue(item)),
    };
  }
  if (typed.kvlistValue) {
    return { type: "kvlist", value: canonicalAttributes(typed.kvlistValue.values) };
  }
  return { type: "empty" };
}

function canonicalAttributes(attributes: unknown): Array<{ key: string; value: unknown }> {
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
    .sort(
      (a, b) =>
        compareOrdinal(a.key, b.key) ||
        compareOrdinal(stableStringify(a.value), stableStringify(b.value)),
    );
}

export { canonicalAnyValue, canonicalAttributes };
