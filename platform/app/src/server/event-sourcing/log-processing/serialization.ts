import { createHash } from "node:crypto";

export type UnknownRecord = Record<string, unknown>;

export const MAX_UINT32 = (1n << 32n) - 1n;
export const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * Deliberately NOT a generic `isRecord` that also accepts arrays. An OTLP log
 * body is an `AnyValue` union in which `arrayValue` and `kvlistValue` are
 * distinct cases, and folding arrays into the record branch would change a
 * body array's `recordId`.
 */
export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Bytewise, never `localeCompare`: ICU collation inverts base62 ordering at the
 * `Z` -> `a` step, which would make `recordId` depend on the runtime's locale.
 */
export function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic JSON: object keys sort; array order stays meaningful. */
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
    if (isRecord(current)) {
      if (seen.has(current))
        throw new Error("cannot canonicalize cyclic OTLP data");
      seen.add(current);
      const result: UnknownRecord = {};
      for (const key of Object.keys(current).sort()) {
        result[key] = normalize(current[key]);
      }
      seen.delete(current);
      return result;
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** OTLP's protobuf-JSON encodes a uint64 as `{ low, high }` on some clients. */
function longBitsToBigInt(value: UnknownRecord): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const high = BigInt(Number(value.high ?? 0) >>> 0);
  return BigInt.asUintN(64, (high << 32n) | low);
}

export function integerDecimal(
  value: unknown,
  label: string,
  max: bigint,
): string {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
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
    throw new Error(
      `OTLP timestamp is outside the supported range: ${timestamp}`,
    );
  }
  return ms;
}
