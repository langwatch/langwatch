/**
 * Hints, never errors: a hard-coded colour in widget code still saves and runs. The hint
 * points at `LW.palette` so the chart follows light and dark instead of staying one mode.
 */

export interface RawColourHint {
  /** 1-based, as Monaco and editors number lines. */
  readonly line: number;
  /** 1-based column of the `#`. */
  readonly column: number;
  /** Length of the hex token, `#` included. */
  readonly length: number;
  readonly hex: string;
  readonly message: string;
}

/** A CSS hex colour: 3, 4, 6 or 8 digits, and no longer word running on from it. */
const HEX_TOKEN =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/y;

/** The hint text, exported so the editor and tests show the same words. */
export const RAW_COLOUR_HINT_MESSAGE =
  "Hard-coded colour: prefer LW.palette.series[n] or LW.chartStyle so it follows light and dark.";

/**
 * Hex colours in string and template literals, e.g. `"#9f7aea"` or `` `${x} #9f7aea` ``. Code
 * and comments are skipped. A quoted string ends at its line, so a JSX apostrophe cannot hide
 * the lines after it.
 */
export function rawColourHints(source: string): readonly RawColourHint[] {
  const cursor: Cursor = { source, index: 0, line: 1, lineStart: 0 };
  const hints: RawColourHint[] = [];
  while (cursor.index < source.length) scanNext(cursor, hints);
  return hints;
}

interface Cursor {
  readonly source: string;
  index: number;
  line: number;
  /** Index where the current line starts, for columns. */
  lineStart: number;
}

function scanNext(cursor: Cursor, hints: RawColourHint[]): void {
  const { source, index } = cursor;
  const ch = source[index];
  const next = source[index + 1];
  if (ch === "\n") consumeNewline(cursor);
  else if (ch === "/" && next === "/") skipLineComment(cursor);
  else if (ch === "/" && next === "*") skipBlockComment(cursor);
  else if (ch === '"' || ch === "'" || ch === "`") scanString(cursor, ch, hints);
  else cursor.index += 1;
}

/** Steps over the newline at the cursor and starts the next line. */
function consumeNewline(cursor: Cursor): void {
  cursor.line += 1;
  cursor.index += 1;
  cursor.lineStart = cursor.index;
}

/** Moves to `stop`, counting any newlines passed on the way. */
function advanceTo(cursor: Cursor, stop: number): void {
  for (let k = cursor.index; k < stop; k += 1) {
    if (cursor.source[k] === "\n") {
      cursor.line += 1;
      cursor.lineStart = k + 1;
    }
  }
  cursor.index = stop;
}

/** Skips a `// ...` comment up to, not including, its newline. */
function skipLineComment(cursor: Cursor): void {
  while (cursor.index < cursor.source.length && cursor.source[cursor.index] !== "\n") {
    cursor.index += 1;
  }
}

/** Skips a block comment through its closing marker, or to the end of the source. */
function skipBlockComment(cursor: Cursor): void {
  const close = cursor.source.indexOf("*/", cursor.index + 2);
  advanceTo(cursor, close === -1 ? cursor.source.length : close + 2);
}

/**
 * Reads a string literal delimited by `quote`. A single or double quoted string stops at a
 * newline without consuming it; a template literal may span lines.
 */
function scanString(cursor: Cursor, quote: string, hints: RawColourHint[]): void {
  const { source } = cursor;
  cursor.index += 1;
  while (cursor.index < source.length && source[cursor.index] !== quote) {
    const here = source[cursor.index];
    if (here === "\n") {
      if (quote !== "`") return;
      consumeNewline(cursor);
    } else if (here === "\\") {
      skipEscape(cursor);
    } else {
      if (here === "#") hexTokenAt(cursor, hints);
      cursor.index += 1;
    }
  }
  if (source[cursor.index] === quote) cursor.index += 1;
}

/** Steps over a backslash escape; an escaped newline still starts a new line. */
function skipEscape(cursor: Cursor): void {
  if (cursor.source[cursor.index + 1] === "\n") {
    cursor.line += 1;
    cursor.lineStart = cursor.index + 2;
  }
  cursor.index += 2;
}

/** Records the hex colour starting at the cursor's `#`, if one does. */
function hexTokenAt(cursor: Cursor, hints: RawColourHint[]): void {
  HEX_TOKEN.lastIndex = cursor.index;
  const match = HEX_TOKEN.exec(cursor.source);
  if (!match) return;
  hints.push({
    line: cursor.line,
    column: cursor.index - cursor.lineStart + 1,
    length: match[0].length,
    hex: match[0],
    message: RAW_COLOUR_HINT_MESSAGE,
  });
}
