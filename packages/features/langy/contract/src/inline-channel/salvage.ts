/**
 * Salvage — the transport-tolerant half of ADR-060 §2. Repairs mechanical
 * fence damage (truncation, unclosed brackets) aggressively, but never
 * guesses CONTENT — the result still must pass the schema STRICTLY.
 */
import { langyModelEmittedCardSchema, type LangyModelEmittedCard } from "../cards/derived-safe.js";

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
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    // Repair below.
  }

  let i = 0;
  const n = text.length;

  const skipWs = (): void => {
    while (i < n && WHITESPACE.has(text[i]!)) i++;
  };

  /** True when everything from `i` on is whitespace (i.e. input exhausted). */
  const atEnd = (): boolean => {
    let j = i;
    while (j < n && WHITESPACE.has(text[j]!)) j++;
    return j >= n;
  };

  const HEX = /[0-9a-fA-F]/;
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

  /**
   * Parse a string from its opening quote. Unterminated at end-of-input is
   * CLOSED with what it has; a raw unescaped newline is kept as literal
   * content — safe because validation is strict afterwards.
   */
  const parseString = (): Step => {
    i++; // opening quote
    let out = "";
    while (i < n) {
      const c = text[i]!;
      if (c === '"') {
        i++;
        return { status: "ok", value: out };
      }
      if (c === "\\") {
        if (i + 1 >= n) {
          // Dangling backslash at end — drop it, close the string.
          i = n;
          return { status: "ok", value: out };
        }
        const esc = text[i + 1]!;
        if (esc === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length === 4 && [...hex].every((h) => HEX.test(h))) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          if (i + 6 >= n) {
            // Truncated \uXX at end — drop the partial escape, close.
            i = n;
            return { status: "ok", value: out };
          }
          return { status: "bad" };
        }
        const mapped = ESCAPES[esc];
        // Unknown escape: keep the escaped character literally (aggressive).
        out += mapped ?? esc;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    // Unterminated at end of input: close it with what it has.
    return { status: "ok", value: out };
  };

  /**
   * Parse a number. A number cut off at the end of input is trimmed back to
   * its longest valid prefix (`12.` → 12, `1e` → 1); a bare sign with no
   * digits is incomplete. Malformed digits mid-text are bad.
   */
  const parseNumber = (): Step => {
    const start = i;
    while (i < n && /[0-9eE+\-.]/.test(text[i]!)) i++;
    let token = text.slice(start, i);
    const truncated = atEnd();
    while (token.length > 0) {
      if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
        return { status: "ok", value: Number(token) };
      }
      if (!truncated) return { status: "bad" };
      token = token.slice(0, -1);
    }
    return truncated ? { status: "incomplete" } : { status: "bad" };
  };

  /** true / false / null, tolerating a prefix cut off at end of input. */
  const parseLiteral = (): Step => {
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return { status: "ok", value };
      }
      const rest = text.slice(i);
      if (word.startsWith(rest)) {
        // The whole remainder is a prefix of the literal — truncated stream.
        i = n;
        return { status: "incomplete" };
      }
    }
    return { status: "bad" };
  };

  const parseObject = (): Step => {
    i++; // {
    const out: Record<string, unknown> = {};
    for (;;) {
      skipWs();
      if (i >= n) return { status: "ok", value: out }; // close at truncation
      const c = text[i]!;
      if (c === "}") {
        i++;
        return { status: "ok", value: out };
      }
      if (c === ",") {
        i++; // tolerates trailing and duplicate commas
        continue;
      }
      if (c !== '"') return { status: "bad" }; // unquoted key = garbage
      const key = parseString();
      if (key.status !== "ok") return { status: "bad" };
      skipWs();
      if (i >= n) return { status: "ok", value: out }; // dangling key: drop
      if (text[i] !== ":") return { status: "bad" };
      i++; // :
      skipWs();
      if (i >= n) return { status: "ok", value: out }; // key with no value: drop
      const value = parseValue();
      if (value.status === "bad") return { status: "bad" };
      if (value.status === "incomplete") return { status: "ok", value: out };
      out[key.value as string] = value.value;
    }
  };

  const parseArray = (): Step => {
    i++; // [
    const out: unknown[] = [];
    for (;;) {
      skipWs();
      if (i >= n) return { status: "ok", value: out }; // close at truncation
      const c = text[i]!;
      if (c === "]") {
        i++;
        return { status: "ok", value: out };
      }
      if (c === ",") {
        i++; // tolerates trailing and duplicate commas
        continue;
      }
      const value = parseValue();
      if (value.status === "bad") return { status: "bad" };
      if (value.status === "incomplete") return { status: "ok", value: out };
      out.push(value.value);
    }
  };

  const parseValue = (): Step => {
    skipWs();
    if (i >= n) return { status: "incomplete" };
    const c = text[i]!;
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    return parseLiteral();
  };

  const top = parseValue();
  if (top.status !== "ok") return { ok: false };
  skipWs();
  // Trailing junk after the document is content we will not guess about —
  // the fence must carry ONE JSON object.
  if (i < n) return { ok: false };
  return { ok: true, value: top.value };
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
