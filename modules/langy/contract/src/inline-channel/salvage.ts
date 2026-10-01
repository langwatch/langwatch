/**
 * Salvage — the transport-tolerant half of ADR-060 §2. Repairs mechanical
 * fence damage (truncation, unclosed brackets) aggressively, but never
 * guesses CONTENT — the result still must pass the schema STRICTLY.
 */
import { langyModelEmittedCardSchema, type LangyModelEmittedCard } from "../cards/derived-safe.ts";

export type LangySalvageResult = { ok: true; value: unknown } | { ok: false };

/** How one tolerant parse step ended. */
type Step =
  | { status: "ok"; value: unknown }
  /** Input exhausted mid-value with nothing usable — parent drops it. */
  | { status: "incomplete" }
  /** Content that is not JSON — the whole salvage fails. */
  | { status: "bad" };

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/**
 * Repair-parse a JSON document, or `{ ok: false }` when the text is not a
 * damaged JSON document but a different thing entirely.
 */
export function salvageJsonText(raw: string): LangySalvageResult {
  const text = raw.trim();
  if (text === "") return { ok: false };

  // Fast path: undamaged.
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    // Repair below.
  }

  const cursor: Cursor = { text, at: 0 };
  const top = parseValue(cursor);
  if (top.status !== "ok") return { ok: false };
  skipWs(cursor);
  // Trailing junk after the document is content we will not guess about —
  // the fence must carry ONE JSON object.
  if (cursor.at < text.length) return { ok: false };
  return { ok: true, value: top.value };
}

type Cursor = { text: string; at: number };

const BAD: { status: "bad" } = { status: "bad" };
const INCOMPLETE: { status: "incomplete" } = { status: "incomplete" };
const ok = (value: unknown): Step => ({ status: "ok", value });

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function skipWs(cursor: Cursor): void {
  while (cursor.at < cursor.text.length && WHITESPACE.has(cursor.text[cursor.at]!)) cursor.at++;
}

/** True when everything from the cursor on is whitespace (i.e. input exhausted). */
function atEnd(cursor: Cursor): boolean {
  const probe: Cursor = { text: cursor.text, at: cursor.at };
  skipWs(probe);
  return probe.at >= cursor.text.length;
}

function parseValue(cursor: Cursor): Step {
  skipWs(cursor);
  if (cursor.at >= cursor.text.length) return INCOMPLETE;
  const c = cursor.text[cursor.at]!;
  if (c === "{") return parseObject(cursor);
  if (c === "[") return parseArray(cursor);
  if (c === '"') return parseString(cursor);
  if (c === "-" || (c >= "0" && c <= "9")) return parseNumber(cursor);
  return parseLiteral(cursor);
}

type EscapeRead = { kind: "char"; char: string } | { kind: "end" } | { kind: "bad" };

/**
 * Parse a string from its opening quote. Unterminated at end-of-input is CLOSED with what it
 * has; a raw unescaped newline is kept as literal content — safe because validation is strict.
 */
function parseString(cursor: Cursor): Step {
  const { text } = cursor;
  cursor.at++; // opening quote
  let out = "";
  while (cursor.at < text.length) {
    const c = text[cursor.at]!;
    if (c === '"') {
      cursor.at++;
      return ok(out);
    }
    if (c !== "\\") {
      out += c;
      cursor.at++;
      continue;
    }
    const escape = readEscape(cursor);
    if (escape.kind === "bad") return BAD;
    if (escape.kind === "end") return ok(out);
    out += escape.char;
  }
  return ok(out);
}

/** One escape from its backslash; a dangling or truncated escape at the end closes the string. */
function readEscape(cursor: Cursor): EscapeRead {
  const { text } = cursor;
  if (cursor.at + 1 >= text.length) {
    cursor.at = text.length;
    return { kind: "end" };
  }
  const esc = text[cursor.at + 1]!;
  if (esc !== "u") {
    cursor.at += 2;
    // Unknown escape: keep the escaped character literally (aggressive).
    return { kind: "char", char: ESCAPES[esc] ?? esc };
  }
  const hex = text.slice(cursor.at + 2, cursor.at + 6);
  if (/^[0-9a-fA-F]{4}$/.test(hex)) {
    cursor.at += 6;
    return { kind: "char", char: String.fromCharCode(parseInt(hex, 16)) };
  }
  if (cursor.at + 6 < text.length) return { kind: "bad" };
  cursor.at = text.length;
  return { kind: "end" };
}

/**
 * Parse a number. A number cut off at the end of input is trimmed back to its longest valid
 * prefix (`12.` → 12, `1e` → 1); a bare sign with no digits is incomplete. Malformed digits
 * mid-text are bad.
 */
function parseNumber(cursor: Cursor): Step {
  const start = cursor.at;
  while (cursor.at < cursor.text.length && /[0-9eE+\-.]/.test(cursor.text[cursor.at]!)) cursor.at++;
  let token = cursor.text.slice(start, cursor.at);
  const truncated = atEnd(cursor);
  while (token.length > 0) {
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(token)) return ok(Number(token));
    if (!truncated) return BAD;
    token = token.slice(0, -1);
  }
  return truncated ? INCOMPLETE : BAD;
}

/** true / false / null, tolerating a prefix cut off at end of input. */
function parseLiteral(cursor: Cursor): Step {
  const rest = cursor.text.slice(cursor.at);
  for (const [word, value] of LITERALS) {
    if (rest.startsWith(word)) {
      cursor.at += word.length;
      return ok(value);
    }
    if (word.startsWith(rest)) {
      // The whole remainder is a prefix of the literal — truncated stream.
      cursor.at = cursor.text.length;
      return INCOMPLETE;
    }
  }
  return BAD;
}

const LITERALS = [
  ["true", true],
  ["false", false],
  ["null", null],
] as const;

/** Where a collection stands before its next element: closed, a separator, or a value. */
function collectionStep(cursor: Cursor, closer: "}" | "]"): "close" | "comma" | "value" {
  skipWs(cursor);
  if (cursor.at >= cursor.text.length) return "close"; // close at truncation
  const c = cursor.text[cursor.at];
  if (c !== closer && c !== ",") return "value";
  cursor.at++; // a comma: tolerates trailing and duplicate commas
  return c === closer ? "close" : "comma";
}

type MemberStep =
  | { status: "ok"; key: string; value: unknown }
  | { status: "incomplete" }
  | { status: "bad" };

/** One `"key": value` pair; a dangling key or a key with no value is incomplete (dropped). */
function parseMember(cursor: Cursor): MemberStep {
  if (cursor.text[cursor.at] !== '"') return BAD; // unquoted key = garbage
  const key = parseString(cursor);
  if (key.status !== "ok") return BAD;
  skipWs(cursor);
  if (cursor.at >= cursor.text.length) return INCOMPLETE;
  if (cursor.text[cursor.at] !== ":") return BAD;
  cursor.at++;
  skipWs(cursor);
  if (cursor.at >= cursor.text.length) return INCOMPLETE;
  const value = parseValue(cursor);
  if (value.status !== "ok") return value;
  return { status: "ok", key: String(key.value), value: value.value };
}

function parseObject(cursor: Cursor): Step {
  cursor.at++; // {
  const out: Record<string, unknown> = {};
  for (;;) {
    const step = collectionStep(cursor, "}");
    if (step === "close") return ok(out);
    if (step === "comma") continue;
    const member = parseMember(cursor);
    if (member.status === "bad") return BAD;
    if (member.status === "incomplete") return ok(out);
    out[member.key] = member.value;
  }
}

function parseArray(cursor: Cursor): Step {
  cursor.at++; // [
  const out: unknown[] = [];
  for (;;) {
    const step = collectionStep(cursor, "]");
    if (step === "close") return ok(out);
    if (step === "comma") continue;
    const value = parseValue(cursor);
    if (value.status === "bad") return BAD;
    if (value.status === "incomplete") return ok(out);
    out.push(value.value);
  }
}

export type LangyDerivedCardParseResult =
  | { ok: true; card: LangyModelEmittedCard }
  | { ok: false; reason: "unsalvageable" | "invalid" };

/**
 * The ONE decision the channel makes about a fence's content (ADR-060 §2):
 * salvage leniently, then validate STRICTLY. Relay and client both use this;
 * nothing else re-decides.
 */
export function salvageLangyDerivedCard(raw: string): LangyDerivedCardParseResult {
  const salvaged = salvageJsonText(raw);
  if (!salvaged.ok) return { ok: false, reason: "unsalvageable" };
  const parsed = langyModelEmittedCardSchema.safeParse(salvaged.value);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, card: parsed.data };
}
