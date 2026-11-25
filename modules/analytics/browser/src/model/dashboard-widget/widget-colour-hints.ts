/**
 * Hints, never errors: a hard-coded colour in widget code still saves and runs. The hint
 * points at a theme value so the chart and its surfaces follow light and dark.
 */

export interface RawColourHint {
  /** 1-based, as Monaco and editors number lines. */
  readonly line: number;
  /** 1-based column of the colour, or of the opening quote for a named colour. */
  readonly column: number;
  /** Length of the hinted text. */
  readonly length: number;
  /** The colour as written: a hex, a function call or `white` or `black`. */
  readonly colour: string;
  readonly message: string;
}

/** A CSS hex colour: 3, 4, 6 or 8 digits, and no longer word running on from it. */
const HEX_TOKEN =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/y;
/** A colour function call such as `rgb(0, 0, 0)` or `hsl(0 0% 0%)`, not part of a word. */
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?)\([^)\n]*\)/iy;
/** A whole string that is `white` or `black`, optionally after a border style. */
const NAMED_COLOUR = /^(?:.*\b(?:solid|dashed|dotted|double)\s+)?(?:white|black)$/i;

/** The hint text, exported so the editor and tests show the same words. */
export const RAW_COLOUR_HINT_MESSAGE =
  "Hard-coded colour: use LW.palette, LW.chartStyle, LW.theme or a CSS variable, " +
  "so it follows light and dark.";

/**
 * Hard-coded colours inside string and template literals. Code and comments are skipped. A
 * quoted string ends at its line, so a JSX apostrophe cannot hide the lines after it.
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
  const start = cursor.index;
  const opened = { line: cursor.line, column: start - cursor.lineStart + 1 };
  cursor.index += 1;
  while (cursor.index < source.length && source[cursor.index] !== quote) {
    const here = source[cursor.index];
    if (here === "\n") {
      if (quote !== "`") break;
      consumeNewline(cursor);
    } else if (here === "\\") {
      skipEscape(cursor);
    } else {
      colourAt(cursor, hints);
      cursor.index += 1;
    }
  }
  const body = source.slice(start + 1, cursor.index);
  if (source[cursor.index] === quote) cursor.index += 1;
  namedColourHint(body, opened, hints);
}

/** Steps over a backslash escape; an escaped newline still starts a new line. */
function skipEscape(cursor: Cursor): void {
  if (cursor.source[cursor.index + 1] === "\n") {
    cursor.line += 1;
    cursor.lineStart = cursor.index + 2;
  }
  cursor.index += 2;
}

/** Records a hex or colour function starting at the cursor, if one does. */
function colourAt(cursor: Cursor, hints: RawColourHint[]): void {
  const colour = colourMatchAt(cursor);
  if (colour === null) return;
  pushHint(hints, {
    line: cursor.line,
    column: cursor.index - cursor.lineStart + 1,
    length: colour.length,
    colour,
  });
}

function colourMatchAt(cursor: Cursor): string | null {
  for (const pattern of [HEX_TOKEN, COLOUR_FUNCTION]) {
    pattern.lastIndex = cursor.index;
    const match = pattern.exec(cursor.source);
    if (match) return match[0];
  }
  return null;
}

/** Records a string that is only `white` or `black`, hinted at its opening quote. */
function namedColourHint(
  body: string,
  opened: { line: number; column: number },
  hints: RawColourHint[],
): void {
  const colour = body.trim();
  if (!NAMED_COLOUR.test(colour)) return;
  pushHint(hints, { ...opened, length: body.length + 2, colour });
}

function pushHint(hints: RawColourHint[], found: Omit<RawColourHint, "message">): void {
  hints.push({ ...found, message: RAW_COLOUR_HINT_MESSAGE });
}
