/**
 * Writing values into a statement, and writing them safely.
 *
 * An app function's options have to be literals: the hydration plan is built
 * before a row comes back, so an option read from a column would make one
 * output column mean different things in different rows. That is checked by the
 * validator, and it is the reason the expansion writes the caller's
 * instructions into the SQL text rather than binding them as parameters.
 *
 * So the escaping here is the only thing between a caller's words and the
 * statement. Two characters matter to a ClickHouse string literal, the quote
 * and the backslash, and both are escaped with a backslash. A statement that
 * escaped them wrongly would not become a different query: it would fail to
 * parse, because the expansion goes through the same validator a submitted
 * statement does, and the validator parses before anything runs.
 *
 * @see ./expand.ts
 * @see ../../../analytics/lwql/validation/appFunctionArguments.ts
 */

/** A value, written as a ClickHouse single-quoted string literal. */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** A list of values, written as a ClickHouse array literal of strings. */
export function sqlStringArray(values: readonly string[]): string {
  return `[${values.map(sqlString).join(", ")}]`;
}

/**
 * A whole number, written as a literal.
 *
 * Refuses anything else outright rather than rounding: every number that
 * reaches here came off a schema that already bounded it, so a non-integer is a
 * programming error and silently flooring it would write a budget or a scale
 * end the caller never asked for.
 */
export function sqlInteger(value: number): string {
  if (!Number.isInteger(value)) {
    throw new Error(`expected a whole number for a SQL literal, got ${value}`);
  }
  return String(value);
}

/**
 * A fraction, written as a literal with a decimal point in it.
 *
 * The point is not decoration. The validator reads a numeric option as "any
 * literal whose parsed type is not String", and a threshold of `1` written as
 * `1` is an integer literal where the catalog declares a non-integer
 * parameter, accepted, but `0` and `1` are the two thresholds a caller is
 * most likely to write, so they are spelled `0.0` and `1.0` for the same
 * reason every other one is.
 */
export function sqlNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/**
 * How an instant is written for a `DateTime64(3)` parameter.
 *
 * Milliseconds, in UTC, in the spelling ClickHouse parses for a bound
 * `DateTime64(3)`. The precision matches the views' own time columns, so a
 * window narrower than a second keeps both of its ends: bound as a plain
 * `DateTime` the two instants would round to the same second and select
 * nothing.
 */
export function clickHouseDateTime64(at: Date): string {
  return at.toISOString().slice(0, 23).replace("T", " ");
}
