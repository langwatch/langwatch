/**
 * OTLP number coercion.
 *
 * Every helper here draws a hard line between "absent" and "present but
 * zero": OTLP carries `0` as a legitimate observation (a gauge reading of
 * zero watts is data; a counter that has not moved yet is data), so every
 * check below is `!== undefined && !== null`, never a truthiness check.
 * `Number(0) || fallback` and `value ? value : fallback` both silently turn a
 * real zero into "nothing was sent" — that is the one bug class this module
 * exists to make structurally hard to write.
 */

import { isRecord, type UnknownRecord } from "./serialization";

export const MAX_UINT32 = (1n << 32n) - 1n;
export const MAX_UINT64 = (1n << 64n) - 1n;
export const MIN_INT32 = -(1n << 31n);
export const MAX_INT32 = (1n << 31n) - 1n;
export const MIN_INT64 = -(1n << 63n);
export const MAX_INT64 = (1n << 63n) - 1n;

/**
 * ECMA-262 caps a valid `Date` at +-8.64e15 ms, narrower than
 * `Number.MAX_SAFE_INTEGER`. Anything past it becomes an Invalid Date on the
 * way into a row.
 */
const MAX_DATE_MS = 8_640_000_000_000_000;

/** OTLP's protobuf-JSON encodes an int64 as `{ low, high }` on some clients. */
function longBitsToBigInt(value: UnknownRecord, signed: boolean): bigint {
  const low = BigInt(Number(value.low ?? 0) >>> 0);
  const high = BigInt(Number(value.high ?? 0) >>> 0);
  const unsigned = (high << 32n) | low;
  return signed ? BigInt.asIntN(64, unsigned) : BigInt.asUintN(64, unsigned);
}

/**
 * Renders any of OTLP's integer encodings (number, decimal string, bigint,
 * `{low,high}`) as a decimal string — the wire shape ClickHouse's Int64/UInt64
 * columns accept, and the only JS-safe way to carry a 64-bit value through
 * JSON.
 */
export function integerDecimal(
  value: unknown,
  options: { signed?: boolean; fallback?: string } = {},
): string {
  const { signed = false, fallback = "0" } = options;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString();
  }
  if (isRecord(value) && "low" in value && "high" in value) {
    return longBitsToBigInt(value, signed).toString();
  }
  return fallback;
}

/** Parses an OTLP integer field, throwing when it falls outside its range. */
export function checkedInteger(args: {
  value: unknown;
  label: string;
  min: bigint;
  max: bigint;
}): bigint {
  const { value, label, min, max } = args;
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

/** A present timestamp as a decimal string, or `null` when genuinely absent. */
export function timestampDecimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const decimal = integerDecimal(value);
  return /^\d+$/.test(decimal) ? decimal : null;
}

export function timestampMs(nanoDecimal: string): number {
  const ms = Number(BigInt(nanoDecimal) / 1_000_000n);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_DATE_MS) {
    throw new Error(
      `OTLP timestamp is outside the supported Date range: ${nanoDecimal}`,
    );
  }
  return ms;
}

/**
 * `0` is a valid finite number and is returned as `0`, not coerced toward
 * `null`. Only genuinely non-numeric or non-finite input becomes `null`.
 */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * An optional OTLP double: `undefined`/`null` mean absent, and anything else
 * must be finite or the point is rejected. Storing NaN/Infinity as NULL while
 * still reporting the point accepted would silently lose the measurement.
 */
export function checkedOptionalDouble(args: {
  value: unknown;
  label: string;
}): number | null {
  const { value, label } = args;
  if (value === undefined || value === null) return null;
  const parsed = finiteNumber(value);
  if (parsed === null) throw new Error(`${label} must be a finite number`);
  return parsed;
}

export function integerDecimals(values: unknown): string[] {
  return Array.isArray(values) ? values.map((v) => integerDecimal(v)) : [];
}

export function finiteNumbers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values.map(finiteNumber).filter((v): v is number => v !== null);
}
