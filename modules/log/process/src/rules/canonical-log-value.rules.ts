import { createHash } from "node:crypto";

/** Ordinal (UTF-16) comparison, the same as the eventing helper without importing it. */
function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export type UnknownRecord = Record<string, unknown>;

const ANY_VALUE_KINDS = [
  "stringValue",
  "boolValue",
  "intValue",
  "doubleValue",
  "bytesValue",
  "arrayValue",
  "kvlistValue",
] as const;
type AnyValueKind = (typeof ANY_VALUE_KINDS)[number];
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * Do not use serialization.isRecord: it accepts arrays, but OTLP arrayValue and
 * kvlistValue must canonicalize separately or their RecordIds change.
 */
export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function longBitsToBigInt(value: UnknownRecord): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const high = BigInt(Number(value.high ?? 0) >>> 0);
  return BigInt.asUintN(64, (high << 32n) | low);
}

export function integerDecimal(value: unknown, label: string, max: bigint): string {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} is not a safely represented unsigned integer`);
  }
  let decimal: string;
  if (typeof value === "bigint") decimal = value.toString();
  else if (typeof value === "string") decimal = value;
  else if (typeof value === "number") decimal = String(value);
  else if (isRecord(value) && "low" in value && "high" in value) {
    decimal = longBitsToBigInt(value).toString();
  } else {
    throw new Error(`${label} is not an integer`);
  }
  if (!/^\d+$/.test(decimal)) throw new Error(`${label} is not an integer`);
  const parsed = BigInt(decimal);
  if (parsed > max) throw new Error(`${label} is outside its OTLP range`);
  return parsed.toString();
}

export function optionalTimestamp(value: unknown, label: string): string {
  if (value === undefined || value === null) return "0";
  return integerDecimal(value, label, MAX_UINT64);
}

export function uint32Number(value: unknown, label: string): number {
  return Number(integerDecimal(value ?? 0, label, MAX_UINT32));
}

export function timestampMs(timestamp: string): number {
  const ms = Number(BigInt(timestamp) / 1_000_000n);
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new Error(`OTLP timestamp is outside the supported range: ${timestamp}`);
  }
  return ms;
}

export function canonicalAnyValue(value: unknown): unknown {
  if (!isRecord(value)) return { type: "empty" };
  const present = ANY_VALUE_KINDS.filter((key) => value[key] !== undefined && value[key] !== null);
  if (present.length === 0) return { type: "empty" };
  if (present.length > 1) throw new Error("OTLP AnyValue contains multiple values");
  const kind = present[0]!;
  return canonicalValueOfKind(kind, value[kind]);
}

function canonicalValueOfKind(kind: AnyValueKind, raw: unknown): unknown {
  switch (kind) {
    case "stringValue":
      if (typeof raw !== "string") throw new Error("stringValue must be a string");
      return { type: "string", value: raw };
    case "boolValue":
      return canonicalBool(raw);
    case "intValue":
      return canonicalInt(raw);
    case "doubleValue":
      return canonicalDouble(raw);
    case "bytesValue":
      return { type: "bytes", value: canonicalBytes(raw) };
    case "arrayValue":
      return canonicalArray(raw);
    case "kvlistValue":
      return canonicalKvlist(raw);
  }
}

function canonicalBool(raw: unknown): unknown {
  if (typeof raw === "boolean") return { type: "bool", value: raw };
  if (raw === "true" || raw === "false") return { type: "bool", value: raw === "true" };
  throw new Error("boolValue must be a boolean");
}

function canonicalInt(raw: unknown): unknown {
  if (typeof raw === "number" && !Number.isSafeInteger(raw)) {
    throw new Error("intValue is not safely represented");
  }
  if (isRecord(raw) && "low" in raw && "high" in raw) {
    const low = BigInt(Number(raw.low ?? 0) >>> 0);
    const high = BigInt(Number(raw.high ?? 0) >>> 0);
    return { type: "int", value: BigInt.asIntN(64, (high << 32n) | low).toString() };
  }
  const decimal = String(raw);
  if (!/^-?\d+$/.test(decimal)) throw new Error("intValue is not an integer");
  return { type: "int", value: BigInt(decimal).toString() };
}

function canonicalDouble(raw: unknown): unknown {
  const number = Number(raw);
  if (!Number.isFinite(number)) throw new Error("doubleValue must be finite");
  return { type: "double", value: number };
}

/** The bytes as base64, whichever of the three wire shapes carried them. */
function canonicalBytes(raw: unknown): string {
  if (typeof raw === "string") {
    const unpadded = raw.replace(/=+$/, "");
    const roundTrip = Buffer.from(raw, "base64").toString("base64").replace(/=+$/, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || roundTrip !== unpadded) {
      throw new Error("bytesValue is not valid base64");
    }
    return Buffer.from(raw, "base64").toString("base64");
  }
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString("base64");
  if (!isRecord(raw)) throw new Error("bytesValue is malformed");
  return Buffer.from(
    Object.entries(raw)
      .toSorted(([left], [right]) => Number(left) - Number(right))
      .map(([, byte]) => Number(byte)),
  ).toString("base64");
}

function canonicalArray(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.values)) {
    throw new Error("arrayValue is malformed");
  }
  return {
    type: "array",
    value: raw.values.map((item) => canonicalAnyValue(item)),
  };
}

function canonicalKvlist(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.values)) {
    throw new Error("kvlistValue is malformed");
  }
  return { type: "kvlist", value: canonicalAttributes(raw.values) };
}

export function canonicalAttributes(attributes: unknown): { key: string; value: unknown }[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((raw) => {
      if (!isRecord(raw) || typeof raw.key !== "string") {
        throw new Error("attribute is malformed");
      }
      return { key: raw.key, value: canonicalAnyValue(raw.value) };
    })
    .toSorted((left, right) => {
      const byKey = compareOrdinal(left.key, right.key);
      return byKey || compareOrdinal(stableStringify(left.value), stableStringify(right.value));
    });
}

function isSerializableRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

/** Deterministic JSON: object keys sort; array order remains meaningful. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === undefined) return { $undefined: true };
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "number" && !Number.isFinite(current)) {
      return { $number: String(current) };
    }
    if (current instanceof Uint8Array) {
      return { $bytes: Buffer.from(current).toString("base64") };
    }
    if (Array.isArray(current)) return current.map(normalize);
    if (isSerializableRecord(current)) {
      return normalizeRecord({ current, normalize, seen });
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

function normalizeRecord({
  current,
  normalize,
  seen,
}: {
  current: UnknownRecord;
  normalize: (value: unknown) => unknown;
  seen: WeakSet<object>;
}): UnknownRecord {
  if (seen.has(current)) throw new Error("Cannot canonicalize cyclic OTLP data");
  seen.add(current);
  const result: UnknownRecord = {};
  for (const key of Object.keys(current).toSorted()) {
    result[key] = normalize(current[key]);
  }
  seen.delete(current);
  return result;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
