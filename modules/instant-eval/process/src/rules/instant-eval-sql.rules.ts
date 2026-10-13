import type { Instant } from "@langwatch/time";

/**
 * Writing values into a statement, and writing them safely: an eval
 * function's options have to be literals, so this is the only thing between a
 * caller's words and the statement.
 */

/** A value, written as a ClickHouse single-quoted string literal. */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** A list of values, written as a ClickHouse array literal of strings. */
export function sqlStringArray(values: readonly string[]): string {
  return `[${values.map(sqlString).join(", ")}]`;
}

/** A whole number. A fraction here is a programming error, not a rounding. */
export function sqlInteger(value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(`expected a whole number for a SQL literal, got ${value}`);
  }
  return String(value);
}

/**
 * A fraction, written with a decimal point: the catalog declares a
 * non-integer parameter, and `1` alone is an integer literal.
 */
export function sqlNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/**
 * How an instant is written for a `DateTime64(3)` parameter: milliseconds in
 * UTC, matching the views' own precision, so a window narrower than a second
 * keeps both of its ends.
 */
export function clickHouseDateTime64(at: Instant): string {
  return at.toString({ smallestUnit: "millisecond" }).slice(0, 23).replace("T", " ");
}
