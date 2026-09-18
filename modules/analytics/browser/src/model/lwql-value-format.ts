/**
 * Pure result-value presentation. Preserve distinct absent, null, empty and
 * non-finite states; digit strings must never be coerced through `Number`.
 */

import type { LangWatchQLColumn } from "@langwatch/analytics-contract";

/**
 * Longest rendering a single cell may put on screen before it is clipped -- a result cell can
 * hold a whole nested document, and a table row that grows to fit one is unscannable. Clipping
 * is always visible (ends in an ellipsis) and never reaches the clipboard.
 */
export const LWQL_VALUE_PREVIEW_LIMIT = 120;

const ELLIPSIS = "…";

/**
 * What a cell is, once absent and non-finite values are told apart. Six
 * emptiness/non-finite cases the spec refuses to collapse are separate
 * variants, not strings, so nothing can accidentally render two the same.
 */
export type LangWatchQLCell =
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
 * Reads one column's value out of a result row, via `Object.hasOwn` rather than an `undefined`
 * check, so a column the row does not carry is distinguishable from one carrying `NULL`. A key
 * holding `undefined` reports the same as an absent one -- plain JSON drops it regardless.
 */
export function readLangWatchQLCell({
  row,
  column,
}: {
  row: Readonly<Record<string, unknown>>;
  column: string;
}): LangWatchQLCell {
  if (!Object.hasOwn(row, column)) return { kind: "missing" };
  return describeLangWatchQLValue(row[column]);
}

/** The same classification, for a value already in hand. */
export function describeLangWatchQLValue(value: unknown): LangWatchQLCell {
  if (value === void 0) return { kind: "missing" };
  if (value === null) return { kind: "null" };

  if (typeof value === "number") return numericCell(value);
  // Never `Number(value)`: a 64-bit integer or a high-precision decimal that
  // arrived quoted is exact as a string and lossy as a double.
  if (typeof value === "string") return stringCell(value);
  if (typeof value === "bigint") return scalarCell(value.toString());
  if (typeof value === "boolean") return scalarCell(String(value));

  return structuredCell(value);
}

function numericCell(value: number): LangWatchQLCell {
  if (Number.isNaN(value)) return { kind: "nan" };
  if (!Number.isFinite(value)) {
    return { kind: "infinity", sign: value > 0 ? "+" : "-" };
  }
  // `String`, not `toLocaleString`: grouping separators are digits the value
  // does not have, and a member reading a result needs the number the database
  // returned rather than a typeset version of it.
  return scalarCell(String(value));
}

function stringCell(value: string): LangWatchQLCell {
  if (value === "") return { kind: "emptyString" };
  return scalarCell(value);
}

function scalarCell(text: string): LangWatchQLCell {
  const { display, clipped } = clip(text);
  return { kind: "scalar", display, copy: text, clipped };
}

/**
 * The indented form is built on first read, not construction: `pretty` is read only by the
 * expanded view, so building it eagerly for every row would indent documents nobody looked at.
 * Memoised behind a getter so a re-render of an open cell does not pay twice.
 */
function structuredCell(value: unknown): LangWatchQLCell {
  const compact = safeJson(value);
  const { display, clipped } = clip(compact);
  let indented: string | undefined;
  return {
    kind: "structured",
    display,
    copy: compact,
    get pretty(): string {
      indented ??= safeJson(value, 2);
      return indented;
    },
    clipped,
  };
}

/**
 * JSON for a value off a database response, guarded: `JSON.stringify` throws on a circular
 * structure and returns `undefined` for a value it can't represent. Also reachable from a
 * caller's own built value, and a cell that throws takes the whole table down.
 */
function safeJson(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The preview, and whether it is the whole value. An over-cap length or an embedded line
 * break sets `clipped`, adding the expander. Breaks are collapsed here, not left to
 * `white-space`, since row height comes from this constant, not measurement.
 */
function clip(text: string): { display: string; clipped: boolean } {
  // \r\n first, so a Windows line ending collapses to one space and not two.
  const flattened = text.replace(/\r\n|\r|\n/g, " ");
  const wrapped = flattened !== text;

  if (flattened.length <= LWQL_VALUE_PREVIEW_LIMIT) {
    return { display: flattened, clipped: wrapped };
  }
  return {
    display: flattened.slice(0, LWQL_VALUE_PREVIEW_LIMIT) + ELLIPSIS,
    clipped: true,
  };
}

/**
 * The text a cell puts on screen — the one place the visible token per kind
 * is decided. `""` and `missing` are deliberately words/marks, not blanks: a
 * blank cell is how these distinct facts would collapse into one.
 */
export function lwqlCellText(cell: LangWatchQLCell): string {
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
 * What copying a cell puts on the clipboard, or `null` for nothing. A scalar copies its exact
 * text (every digit of a wide number that arrived as a string); an absent value copies as
 * nothing, never the word `missing`, so a paste can't manufacture that literal text.
 */
export function lwqlCellCopyText(cell: LangWatchQLCell): string | null {
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
 * Column names the response used more than once, in first-seen order. A row
 * arrives keyed by column name, so a duplicate already collapsed to one
 * value by the time anything renders — the only honest move is to say so.
 */
export function duplicateLangWatchQLColumnNames(columns: readonly LangWatchQLColumn[]): string[] {
  const counts = new Map<string, number>();
  for (const column of columns) {
    counts.set(column.name, (counts.get(column.name) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const column of columns) {
    const isNewDuplicate = (counts.get(column.name) ?? 0) > 1 && !seen.has(column.name);
    if (isNewDuplicate) {
      seen.add(column.name);
      duplicates.push(column.name);
    }
  }
  return duplicates;
}
