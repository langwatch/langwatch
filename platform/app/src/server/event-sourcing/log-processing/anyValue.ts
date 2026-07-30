import {
  compareOrdinal,
  isRecord,
  stableStringify,
} from "./serialization";

/** The canonical, typed rendering of one OTLP `AnyValue`. */
export type CanonicalAnyValue =
  | { readonly type: "empty" }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "int"; readonly value: string }
  | { readonly type: "double"; readonly value: number }
  | { readonly type: "bytes"; readonly value: string }
  | { readonly type: "array"; readonly value: readonly CanonicalAnyValue[] }
  | { readonly type: "kvlist"; readonly value: readonly CanonicalAttribute[] };

export interface CanonicalAttribute {
  readonly key: string;
  readonly value: CanonicalAnyValue;
}

/**
 * Preserves an `AnyValue`'s type and shape exactly. Anything not cleanly one of
 * OTLP's seven cases is a rejection, not a best-effort coercion: a structured
 * body that half-parses is worse than one that is loudly refused.
 */
export function canonicalAnyValue(value: unknown): CanonicalAnyValue {
  if (!isRecord(value)) return { type: "empty" };
  const present = [
    "stringValue",
    "boolValue",
    "intValue",
    "doubleValue",
    "bytesValue",
    "arrayValue",
    "kvlistValue",
  ].filter((key) => value[key] !== undefined && value[key] !== null);
  if (present.length === 0) return { type: "empty" };
  if (present.length > 1)
    throw new Error("OTLP AnyValue contains multiple values");
  const kind = present[0]!;

  if (kind === "stringValue") {
    if (typeof value.stringValue !== "string")
      throw new Error("stringValue must be a string");
    return { type: "string", value: value.stringValue };
  }
  if (kind === "boolValue") {
    const bool = value.boolValue;
    if (typeof bool === "boolean") return { type: "bool", value: bool };
    if (bool === "true" || bool === "false")
      return { type: "bool", value: bool === "true" };
    throw new Error("boolValue must be a boolean");
  }
  if (kind === "intValue") {
    const raw = value.intValue;
    if (typeof raw === "number" && !Number.isSafeInteger(raw)) {
      throw new Error("intValue is not safely represented");
    }
    if (isRecord(raw) && "low" in raw && "high" in raw) {
      const low = BigInt(Number(raw.low ?? 0) >>> 0);
      const high = BigInt(Number(raw.high ?? 0) >>> 0);
      return {
        type: "int",
        value: BigInt.asIntN(64, (high << 32n) | low).toString(),
      };
    }
    const decimal = String(raw);
    if (!/^-?\d+$/.test(decimal)) throw new Error("intValue is not an integer");
    return { type: "int", value: BigInt(decimal).toString() };
  }
  if (kind === "doubleValue") {
    const number = Number(value.doubleValue);
    if (!Number.isFinite(number)) throw new Error("doubleValue must be finite");
    return { type: "double", value: number };
  }
  if (kind === "bytesValue") {
    const raw = value.bytesValue;
    if (typeof raw === "string") {
      const unpadded = raw.replace(/=+$/, "");
      const roundTrip = Buffer.from(raw, "base64")
        .toString("base64")
        .replace(/=+$/, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || roundTrip !== unpadded) {
        throw new Error("bytesValue is not valid base64");
      }
    }
    const bytes =
      raw instanceof Uint8Array
        ? raw
        : typeof raw === "string"
          ? Buffer.from(raw, "base64")
          : isRecord(raw)
            ? Buffer.from(
                Object.entries(raw)
                  .sort(([left], [right]) => Number(left) - Number(right))
                  .map(([, byte]) => Number(byte)),
              )
            : null;
    if (!bytes) throw new Error("bytesValue is malformed");
    return { type: "bytes", value: Buffer.from(bytes).toString("base64") };
  }
  if (kind === "arrayValue") {
    const array = value.arrayValue;
    if (!isRecord(array) || !Array.isArray(array.values))
      throw new Error("arrayValue is malformed");
    return {
      type: "array",
      value: array.values.map((item) => canonicalAnyValue(item)),
    };
  }
  const list = value.kvlistValue;
  if (!isRecord(list) || !Array.isArray(list.values))
    throw new Error("kvlistValue is malformed");
  return { type: "kvlist", value: canonicalAttributes(list.values) };
}

/**
 * Each value keeps its OTLP type, and the list sorts by key then by a stable
 * stringification of the value: OTLP does not guarantee attribute order on the
 * wire, and a redelivered batch must hash to the same `recordId`.
 */
export function canonicalAttributes(
  attributes: unknown,
): CanonicalAttribute[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((raw) => {
      if (!isRecord(raw) || typeof raw.key !== "string")
        throw new Error("attribute is malformed");
      return { key: raw.key, value: canonicalAnyValue(raw.value) };
    })
    .sort((left, right) => {
      const byKey = compareOrdinal(left.key, right.key);
      return (
        byKey ||
        compareOrdinal(
          stableStringify(left.value),
          stableStringify(right.value),
        )
      );
    });
}

/**
 * A flat `dot.path -> string` view, used for the record's `*AttributesFlatJson`
 * columns and for the well-known scalar keys correlation synthesis reads.
 */
export function flattenAttributes(
  attributes: readonly CanonicalAttribute[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (prefix: string, value: CanonicalAnyValue): void => {
    switch (value.type) {
      case "empty":
        return;
      case "string":
        out[prefix] = value.value;
        return;
      case "bool":
        out[prefix] = String(value.value);
        return;
      case "int":
        out[prefix] = value.value;
        return;
      case "double":
        out[prefix] = String(value.value);
        return;
      case "bytes":
        out[prefix] = value.value;
        return;
      case "array":
        value.value.forEach((item, index) => visit(`${prefix}.${index}`, item));
        return;
      case "kvlist":
        for (const attr of value.value)
          visit(`${prefix}.${attr.key}`, attr.value);
        return;
    }
  };
  for (const attr of attributes) visit(attr.key, attr.value);
  return out;
}
