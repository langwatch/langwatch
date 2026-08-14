/**
 * How one cell of a governed SQL result becomes something a member can read
 * without being misled about what the database actually returned.
 *
 * Pure and DOM-free, so every distinction below is provable without rendering.
 * The component layer decides how a token *looks*; this decides what it *says*,
 * which is the half that can lie.
 *
 * ## What actually arrives here — measured, not assumed
 *
 * The executor asks for `format: "JSON"` and reads the body with
 * `resultSet.json()` (`~/server/analytics/governed-sql/executor.ts:218-226`),
 * which is `JSON.parse` on the whole response. The result then crosses tRPC,
 * whose transformer is superjson (`~/server/api/trpc.ts:381`).
 *
 * Observed against `clickhouse/clickhouse-server:25.10.2.65` over that same
 * HTTP path, with the settings the shipped profile leaves at their defaults
 * (the profile pins `readonly = 1 CONST`, so a caller cannot change them):
 *
 * | SQL value                          | JSON body            |
 * | ---------------------------------- | -------------------- |
 * | `toInt64(9007199254740993)`        | `9007199254740993`   |
 * | `toDecimal128('123….123456789',9)` | `12345678901234567890.123456789` |
 * | `0/0`, `1/0` (Float64)             | `null`               |
 * | `NULL`                             | `null`               |
 * | `''`                               | `""`                 |
 * | `[1,2]` / `map('a','b')` / tuple   | `[1,2]` / `{"a":"b"}` / `[1,"x"]` |
 *
 * Two consequences that shape everything below.
 *
 * **64-bit integers are NOT quoted by default in this version.**
 * `output_format_json_quote_64bit_integers` defaults to `0`, so the digits go
 * through `JSON.parse` as a JSON number and are rounded to the nearest double
 * before this module ever sees them — `9007199254740993` arrives as
 * `9007199254740992`. That loss happens upstream and cannot be undone here.
 * But the setting is a deployment's to change, and with it on the same value
 * arrives as the string `"9007199254740993"`. So the rule this module can and
 * does keep: **a value that arrives as a digit string is rendered and copied as
 * that exact string, never coerced through `Number`** — coercion would destroy
 * precision that did survive. Verified: `Number("9007199254740993")` is
 * `9007199254740992`.
 *
 * **Non-finite floats arrive as `null` from this server**, because
 * `output_format_json_quote_denormals` defaults to `0`. They are still handled
 * here for two reasons: with that setting on they arrive as the strings
 * `"nan"` / `"inf"`, and superjson carries real `NaN`, `Infinity`, `-Infinity`
 * and `undefined` across the wire intact, so nothing downstream flattens them.
 * A cell that holds one must not be shown as the `null` it is not.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import type { GovernedSqlColumn } from "~/server/analytics/governed-sql";

/**
 * Longest rendering a single cell may put on screen before it is clipped.
 *
 * A result cell can hold a whole nested document; a table row that grows to
 * fit one is a table nobody can scan. Clipping is always visible (the token
 * ends in an ellipsis) and never reaches the clipboard.
 */
export const GOVERNED_SQL_VALUE_PREVIEW_LIMIT = 120;

const ELLIPSIS = "…";

/**
 * What a cell is, once the ways a value can be absent or non-finite have been
 * told apart from each other.
 *
 * Six of these are the emptiness-and-non-finite cases the spec refuses to let
 * collapse: `missing`, `null`, an empty string, zero (an ordinary `scalar`),
 * `NaN`, and `Infinity`. They are separate variants rather than separate
 * strings so that neither this module nor a caller can accidentally render two
 * of them the same way.
 */
export type GovernedSqlCell =
  /** The column exists, but the row object carries no value under its name. */
  | { readonly kind: "missing" }
  /** SQL `NULL`. */
  | { readonly kind: "null" }
  /** A string that is present and empty — not absent, not null. */
  | { readonly kind: "emptyString" }
  | { readonly kind: "nan" }
  | { readonly kind: "infinity"; readonly sign: "+" | "-" }
  | {
      readonly kind: "scalar";
      /** What the member sees; clipped when the value is longer than the cap. */
      readonly display: string;
      /** The whole value, whatever the display shows. */
      readonly copy: string;
      readonly clipped: boolean;
    }
  | {
      readonly kind: "structured";
      /** A bounded one-line preview of the structure. */
      readonly display: string;
      /** Compact JSON of the whole value — what a copy hands over. */
      readonly copy: string;
      /** Indented JSON, for reading the whole value in an expanded view. */
      readonly pretty: string;
      readonly clipped: boolean;
    };

/**
 * Reads one column's value out of a result row.
 *
 * Uses `Object.hasOwn` rather than an `undefined` check so that a column the
 * row simply does not carry is distinguishable from one carrying `NULL`. A key
 * present but holding `undefined` — which superjson can deliver — says no more
 * than an absent one and is reported the same way.
 */
export function readGovernedSqlCell({
  row,
  column,
}: {
  row: Readonly<Record<string, unknown>>;
  column: string;
}): GovernedSqlCell {
  if (!Object.hasOwn(row, column)) return { kind: "missing" };
  return describeGovernedSqlValue(row[column]);
}

/** The same classification, for a value already in hand. */
export function describeGovernedSqlValue(value: unknown): GovernedSqlCell {
  if (value === undefined) return { kind: "missing" };
  if (value === null) return { kind: "null" };

  if (typeof value === "number") return numericCell(value);
  // Never `Number(value)`: a 64-bit integer or a high-precision decimal that
  // arrived quoted is exact as a string and lossy as a double.
  if (typeof value === "string") return stringCell(value);
  if (typeof value === "bigint") return scalarCell(value.toString());
  if (typeof value === "boolean") return scalarCell(String(value));

  return structuredCell(value);
}

function numericCell(value: number): GovernedSqlCell {
  if (Number.isNaN(value)) return { kind: "nan" };
  if (!Number.isFinite(value)) {
    return { kind: "infinity", sign: value > 0 ? "+" : "-" };
  }
  // `String`, not `toLocaleString`: grouping separators are digits the value
  // does not have, and a member reading a result needs the number the database
  // returned rather than a typeset version of it.
  return scalarCell(String(value));
}

function stringCell(value: string): GovernedSqlCell {
  if (value === "") return { kind: "emptyString" };
  return scalarCell(value);
}

function scalarCell(text: string): GovernedSqlCell {
  const { display, clipped } = clip(text);
  return { kind: "scalar", display, copy: text, clipped };
}

function structuredCell(value: unknown): GovernedSqlCell {
  const compact = safeJson(value);
  const { display, clipped } = clip(compact);
  return {
    kind: "structured",
    display,
    copy: compact,
    pretty: safeJson(value, 2),
    clipped,
  };
}

/**
 * JSON for a value that came off a database response.
 *
 * Guarded because `JSON.stringify` throws on a circular structure and returns
 * `undefined` for a value it cannot represent. Neither can come out of
 * `JSON.parse`, but this function is also reachable from a caller holding a
 * value it built itself, and a cell that throws takes the whole table down.
 */
function safeJson(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The preview, and whether it is the whole value.
 *
 * Two things can make a preview stand in for the value rather than be it: the
 * value being longer than the cap, and the value carrying its own line breaks.
 * Both set `clipped`, which is what puts the expander on the cell — a member
 * who is not looking at the whole value has to be able to reach it.
 *
 * The line breaks go before the cap is applied, so the limit counts what is on
 * screen. They are collapsed here rather than left to `white-space` because the
 * table gives every row one fixed height and sizes its scroll range from that
 * constant rather than from measurement: a cell that renders two lines is
 * taller than the range it was counted into, and the padding rows stop adding
 * up. Leaving it to CSS would also keep the breaks in the DOM, where they still
 * reach anyone copying a selection or listening to a screen reader.
 */
function clip(text: string): { display: string; clipped: boolean } {
  // \r\n first, so a Windows line ending collapses to one space and not two.
  const flattened = text.replace(/\r\n|\r|\n/g, " ");
  const wrapped = flattened !== text;

  if (flattened.length <= GOVERNED_SQL_VALUE_PREVIEW_LIMIT) {
    return { display: flattened, clipped: wrapped };
  }
  return {
    display: flattened.slice(0, GOVERNED_SQL_VALUE_PREVIEW_LIMIT) + ELLIPSIS,
    clipped: true,
  };
}

/**
 * The text a cell puts on screen.
 *
 * The one place the visible token for each kind is decided, so a test can prove
 * the kinds stay distinguishable and no surface can quietly disagree with it.
 * `""` for the empty string and `missing` for an absent key are deliberately
 * *words and marks*, not blanks: a blank cell is exactly how these three
 * different facts would collapse into one.
 */
export function governedSqlCellText(cell: GovernedSqlCell): string {
  switch (cell.kind) {
    case "missing":
      return "missing";
    case "null":
      return "null";
    case "emptyString":
      return '""';
    case "nan":
      return "NaN";
    case "infinity":
      return cell.sign === "+" ? "Infinity" : "-Infinity";
    case "scalar":
    case "structured":
      return cell.display;
  }
}

/**
 * What copying a cell puts on the clipboard, or `null` when there is nothing
 * to copy.
 *
 * A structure copies as compact JSON and a scalar copies as its exact text —
 * which is what keeps every digit of a wide integer or decimal that arrived as
 * a string. An absent value copies as nothing rather than as the word standing
 * in for it, so a paste never turns "this row had no such key" into the literal
 * text `missing`.
 */
export function governedSqlCellCopyText(cell: GovernedSqlCell): string | null {
  switch (cell.kind) {
    case "missing":
      return null;
    case "null":
      return "null";
    case "emptyString":
      return "";
    case "nan":
      return "NaN";
    case "infinity":
      return cell.sign === "+" ? "Infinity" : "-Infinity";
    case "scalar":
    case "structured":
      return cell.copy;
  }
}

/**
 * Column names the response used more than once, in the order they first
 * appear.
 *
 * A row arrives as an object keyed by column name, so two columns sharing a
 * name have already collapsed to one value by the time anything renders — the
 * second overwrote the first during parsing. Nothing downstream can recover the
 * lost column, so the only honest move is to say so.
 */
export function duplicateGovernedSqlColumnNames(
  columns: readonly GovernedSqlColumn[],
): string[] {
  const counts = new Map<string, number>();
  for (const column of columns) {
    counts.set(column.name, (counts.get(column.name) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const column of columns) {
    if ((counts.get(column.name) ?? 0) > 1 && !seen.has(column.name)) {
      seen.add(column.name);
      duplicates.push(column.name);
    }
  }
  return duplicates;
}
