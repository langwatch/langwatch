import { isRecord, type UnknownRecord } from "./serialization";

export const MAX_UINT32 = (1n << 32n) - 1n;
export const MAX_UINT64 = (1n << 64n) - 1n;
export const MIN_INT32 = -(1n << 31n);
export const MAX_INT32 = (1n << 31n) - 1n;
export const MIN_INT64 = -(1n << 63n);
export const MAX_INT64 = (1n << 63n) - 1n;

/**
 * ECMA-262 caps a valid Date time value at ±8.64e15 ms, which is narrower than
 * `Number.MAX_SAFE_INTEGER`. Anything beyond it becomes an Invalid Date on the
 * way to ClickHouse.
 */
const MAX_DATE_MS = 8_640_000_000_000_000;

function longBitsToBigInt({
  value,
  signed,
}: {
  value: UnknownRecord;
  signed: boolean;
}): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const highNumber = Number(value.high ?? 0);
  const high = BigInt(highNumber >>> 0);
  const unsigned = (high << 32n) | low;
  return signed ? BigInt.asIntN(64, unsigned) : BigInt.asUintN(64, unsigned);
}

export function integerDecimal(
  value: unknown,
  {
    signed = false,
    fallback = "0",
  }: { signed?: boolean; fallback?: string } = {},
): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString();
  }
  if (isRecord(value) && "low" in value && "high" in value) {
    return longBitsToBigInt({ value, signed }).toString();
  }
  return fallback;
}

export function checkedInteger({
  value,
  label,
  min,
  max,
}: {
  value: unknown;
  label: string;
  min: bigint;
  max: bigint;
}): bigint {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || !Number.isInteger(value))
  ) {
    throw new Error(`${label} is not a safely represented integer`);
  }
  const decimal = integerDecimal(value, {
    signed: min < 0n,
    fallback: "invalid",
  });
  if (!/^-?\d+$/.test(decimal)) throw new Error(`${label} is not an integer`);
  const parsed = BigInt(decimal);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} is outside its OTLP integer range`);
  }
  return parsed;
}

export function timestampDecimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const decimal = integerDecimal(value);
  return /^\d+$/.test(decimal) ? decimal : null;
}

export function timestampMs(decimal: string): number {
  const ms = Number(BigInt(decimal) / 1_000_000n);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_DATE_MS) {
    throw new Error(
      `OTLP timestamp is outside the supported Date range: ${decimal}`,
    );
  }
  return ms;
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Returns the canonical form of an optional OTLP double, or throws when one is
 * present but unrepresentable. Storing NaN or ±Infinity as NULL while still
 * reporting the point as accepted loses the measurement silently, so the point
 * is rejected instead and OTLP partial-success reports it.
 */
export function checkedOptionalDouble({
  value,
  label,
}: {
  value: unknown;
  label: string;
}): number | null {
  if (value === undefined || value === null) return null;
  const parsed = finiteNumber(value);
  if (parsed === null) throw new Error(`${label} must be a finite number`);
  return parsed;
}

export function checkedDouble({
  value,
  label,
}: {
  value: unknown;
  label: string;
}): number {
  const parsed = checkedOptionalDouble({ value, label });
  if (parsed === null) throw new Error(`${label} must be a finite number`);
  return parsed;
}

export function integerDecimals(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => integerDecimal(value))
    : [];
}

export function finiteNumbers(values: unknown): number[] {
  return Array.isArray(values)
    ? values
        .map(finiteNumber)
        .filter((value): value is number => value !== null)
    : [];
}
