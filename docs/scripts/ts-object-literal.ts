/**
 * Reads a TypeScript object literal as data: objects, arrays, strings (including template
 * literals without interpolation), numbers, booleans, null and undefined. Anything else is code,
 * and is refused rather than run.
 */

export type Literal =
  | string
  | number
  | boolean
  | null
  | undefined
  | Literal[]
  | { [key: string]: Literal };

type Cursor = { source: string; at: number };

const WORD = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false|null|undefined/y;
const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
  "\n": "",
};

/** `\uXXXX` and `\xXX`: how many hex digits follow the letter. */
const HEX_ESCAPE_WIDTHS: Record<string, number> = { u: 4, x: 2 };

/** Parses the literal that starts at `source[0]`; trailing text is refused. */
export function readObjectLiteral(source: string): Literal {
  const cursor: Cursor = { source, at: 0 };
  const value = readValue(cursor);
  skipTrivia(cursor);
  if (cursor.at !== source.length) refuse(cursor, "text after the literal");
  return value;
}

function refuse(cursor: Cursor, what: string): never {
  const around = cursor.source.slice(cursor.at, cursor.at + 40);
  throw new Error(`Not a data literal at offset ${cursor.at} (${what}): ${JSON.stringify(around)}`);
}

function skipTrivia(cursor: Cursor): void {
  const { source } = cursor;
  while (cursor.at < source.length) {
    if (/\s/.test(source[cursor.at] ?? "")) {
      cursor.at++;
    } else if (source.startsWith("//", cursor.at)) {
      const end = source.indexOf("\n", cursor.at);
      cursor.at = end === -1 ? source.length : end + 1;
    } else if (source.startsWith("/*", cursor.at)) {
      const end = source.indexOf("*/", cursor.at + 2);
      if (end === -1) refuse(cursor, "unterminated comment");
      cursor.at = end + 2;
    } else {
      return;
    }
  }
}

function readValue(cursor: Cursor): Literal {
  skipTrivia(cursor);
  const char = cursor.source[cursor.at];
  if (char === "{") return readObject(cursor);
  if (char === "[") return readArray(cursor);
  if (char === '"' || char === "'" || char === "`") return readString(cursor);
  return readWord(cursor);
}

/** After an entry: a comma continues the list, the closing mark ends it. */
function continues(cursor: Cursor, close: string): boolean {
  skipTrivia(cursor);
  const char = cursor.source[cursor.at];
  if (char === ",") {
    cursor.at++;
    return true;
  }
  if (char !== close) refuse(cursor, `expected "," or "${close}"`);
  return false;
}

/** Whether the list is at its closing mark, which it then steps over. */
function closes(cursor: Cursor, close: string): boolean {
  skipTrivia(cursor);
  if (cursor.source[cursor.at] !== close) return false;
  cursor.at++;
  return true;
}

function readObject(cursor: Cursor): Literal {
  cursor.at++;
  const out: { [key: string]: Literal } = {};
  while (!closes(cursor, "}")) {
    const key = readKey(cursor);
    skipTrivia(cursor);
    if (cursor.source[cursor.at] !== ":") refuse(cursor, 'expected ":"');
    cursor.at++;
    out[key] = readValue(cursor);
    if (!continues(cursor, "}")) {
      cursor.at++;
      return out;
    }
  }
  return out;
}

function readArray(cursor: Cursor): Literal {
  cursor.at++;
  const out: Literal[] = [];
  while (!closes(cursor, "]")) {
    out.push(readValue(cursor));
    if (!continues(cursor, "]")) {
      cursor.at++;
      return out;
    }
  }
  return out;
}

function readKey(cursor: Cursor): string {
  const char = cursor.source[cursor.at];
  if (char === '"' || char === "'") return readString(cursor);
  IDENTIFIER.lastIndex = cursor.at;
  const identifier = IDENTIFIER.exec(cursor.source)?.[0];
  if (identifier === undefined) refuse(cursor, "expected a property name");
  cursor.at += identifier.length;
  return identifier;
}

function readString(cursor: Cursor): string {
  const { source } = cursor;
  const quote = source[cursor.at];
  cursor.at++;
  let out = "";
  for (;;) {
    const char = source[cursor.at];
    if (char === undefined) refuse(cursor, "unterminated string");
    if (char === quote) {
      cursor.at++;
      return out;
    }
    if (quote === "`" && source.startsWith("${", cursor.at)) refuse(cursor, "interpolation");
    if (char === "\\") {
      out += readEscape(cursor);
    } else {
      out += char;
      cursor.at++;
    }
  }
}

function readEscape(cursor: Cursor): string {
  const { source } = cursor;
  const char = source[cursor.at + 1] ?? "";
  cursor.at += 2;
  if (char in SIMPLE_ESCAPES) return SIMPLE_ESCAPES[char] ?? "";
  if (char === "\r") {
    if (source[cursor.at] === "\n") cursor.at++;
    return "";
  }
  const width = HEX_ESCAPE_WIDTHS[char];
  if (width === undefined) return char;
  const hex = source.slice(cursor.at, cursor.at + width);
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) refuse(cursor, "bad escape");
  cursor.at += width;
  return String.fromCharCode(Number.parseInt(hex, 16));
}

function readWord(cursor: Cursor): Literal {
  WORD.lastIndex = cursor.at;
  const word = WORD.exec(cursor.source)?.[0];
  if (word === undefined) refuse(cursor, "expected a value");
  cursor.at += word.length;
  if (word === "true") return true;
  if (word === "false") return false;
  if (word === "null") return null;
  if (word === "undefined") return undefined;
  return Number(word);
}
