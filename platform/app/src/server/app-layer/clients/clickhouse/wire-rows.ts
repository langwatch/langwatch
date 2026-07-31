/**
 * Turns the positional result `@langwatch/clickhouse`'s client returns into the
 * named-object rows the application's hand-written SQL reads.
 *
 * The package client speaks `JSONCompactEachRowWithNamesAndTypes` — one array
 * per row, with the column names and types arriving as the first two lines
 * (ADR-099). Hand-written SQL in this application was written against
 * `JSONEachRow`, which hands back an object per row. This module is the
 * translation between the two, and it exists rather than every call site
 * indexing into a positional array because the SQL is hand-written: a query
 * that gains a column in the middle of its `SELECT` list would silently shift
 * every later index, and nothing would fail until a value landed in the wrong
 * field.
 *
 * It also repairs one difference the format change would otherwise smuggle in.
 * The package client sends `output_format_json_quote_64bit_integers: 1` on
 * every read, with no override point, because its own `ch.uint64()` codec
 * decodes to `bigint` and needs the wire cell quoted to do that without losing
 * precision above 2^53. A stock ClickHouse server defaults that setting to `0`
 * — confirmed against the running server, `system.settings` reports
 * `default: 0` — so the driver-based path this replaces received 64-bit columns
 * as unquoted JSON numbers, and the call sites read them as `number`. Handing
 * those same call sites a `string` instead would not fail: it would produce
 * `"12" > 9` comparisons that are `false`, `+` concatenations, and totals that
 * are wrong rather than absent. So {@link decodeWireRows} converts a quoted
 * 64-bit cell back to `number`, using the header's declared type rather than
 * guessing from the value, and reproduces the previous behaviour exactly —
 * including its imprecision above 2^53, which is a property of the data these
 * queries already carried and not something to silently change under them.
 */

/** The header line pair `JSONCompactEachRowWithNamesAndTypes` puts first. */
export interface WireHeader {
  readonly names: readonly string[];
  readonly types: readonly string[];
}

/**
 * Strips the wrappers that do not change how a cell arrives on the wire.
 *
 * `Nullable(UInt64)` quotes its non-null values exactly as `UInt64` does, and
 * `LowCardinality(...)` is a storage encoding with no wire effect at all, so
 * both unwrap to the type that decides the cell shape.
 */
function unwrapType(type: string): string {
  let current = type.trim();
  for (;;) {
    const match = /^(Nullable|LowCardinality)\((.*)\)$/s.exec(current);
    if (!match?.[2]) return current;
    current = match[2].trim();
  }
}

const QUOTED_64BIT_TYPES = new Set([
  "Int64",
  "UInt64",
  "Int128",
  "UInt128",
  "Int256",
  "UInt256",
]);

/**
 * How a column's cells must be converted, decided once per column from the
 * header rather than per cell from the value.
 *
 * Deciding per value would be a guess: a `String` column holding `"123"` is
 * indistinguishable from a quoted `UInt64` holding `123`, and converting it
 * would corrupt an id. The header removes the guess.
 */
type CellConversion = "none" | "number" | "numberArray";

function conversionFor(type: string): CellConversion {
  const bare = unwrapType(type);
  if (QUOTED_64BIT_TYPES.has(bare)) return "number";

  const arrayMatch = /^Array\((.*)\)$/s.exec(bare);
  if (arrayMatch?.[1] && QUOTED_64BIT_TYPES.has(unwrapType(arrayMatch[1]))) {
    return "numberArray";
  }

  return "none";
}

function convertCell(value: unknown, conversion: CellConversion): unknown {
  if (conversion === "none" || value === null || value === undefined) {
    return value;
  }

  if (conversion === "number") {
    return typeof value === "string" ? Number(value) : value;
  }

  return Array.isArray(value)
    ? value.map((element) =>
        typeof element === "string" ? Number(element) : element,
      )
    : value;
}

/**
 * Rebuilds `{ column: value }` rows from the client's positional result.
 *
 * A result with no header — which the client returns whenever the caller asked
 * for a non-default format — cannot be rebuilt, and returning `[]` would report
 * "no rows" for a query that found some. It throws instead: the caller has a
 * bug, and a loud one is cheaper than an empty list that looks like data.
 */
export function decodeWireRows<T>(result: {
  rows: readonly unknown[][];
  header?: WireHeader;
}): T[] {
  if (result.rows.length === 0) return [];

  const header = result.header;
  if (!header) {
    throw new Error(
      "ClickHouse result carried no column header: decodeWireRows requires the client's default JSONCompactEachRowWithNamesAndTypes format",
    );
  }

  const names = header.names;
  const conversions = header.types.map(conversionFor);

  return result.rows.map((row) => {
    const object: Record<string, unknown> = {};
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      if (name === undefined) continue;
      object[name] = convertCell(row[index], conversions[index] ?? "none");
    }
    return object as T;
  });
}
