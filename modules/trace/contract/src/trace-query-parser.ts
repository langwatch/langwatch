/**
 * Query-language parsing: wraps liqe with normalisation, LRU caching, and
 * post-processing fixes (liqe's serializer occasionally emits unparseable output).
 */

import {
  type LiqeQuery,
  SyntaxError as LiqeSyntaxError,
  parse as liqeParse,
  serialize as liqeRawSerialize,
} from "liqe";

export type {
  LiqeQuery,
  LogicalExpressionToken,
  ParenthesizedExpressionToken,
  TagToken,
  UnaryOperatorToken,
} from "liqe";

/** Parse already-normalised query syntax without applying browser editor affordances. */
export function parseTraceQuerySyntax(query: string): LiqeQuery {
  return liqeParse(query);
}

/**
 * Fix liqe serializer output that its own parser rejects (missing space after
 * `]`/`)` before boolean ops, stray whitespace in parens). Normalise
 * post-serialisation while preserving quoted strings.
 */
function splitOnQuotes(s: string): Array<{ text: string; quoted: boolean }> {
  const segments: Array<{ text: string; quoted: boolean }> = [];
  let buf = "";
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (quoteChar) {
      buf += ch;
      if (ch === quoteChar && s[i - 1] !== "\\") {
        segments.push({ text: buf, quoted: true });
        buf = "";
        quoteChar = "";
      }
    } else if (ch === '"' || ch === "'") {
      if (buf) {
        segments.push({ text: buf, quoted: false });
      }
      buf = ch;
      quoteChar = ch;
    } else {
      buf += ch;
    }
  }
  if (buf) {
    segments.push({ text: buf, quoted: quoteChar !== "" });
  }
  return segments;
}

function normalizeQueryString(s: string): string {
  return splitOnQuotes(s)
    .map((seg) =>
      seg.quoted
        ? seg.text
        : seg.text
            .replace(/([)\]])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
            .replace(/\b(?:AND|OR|NOT)\b\s+/gi, (m) => m.replace(/\s+/g, " "))
            // Collapse whitespace immediately inside parens — `( a` / `a )`
            // are serializer artifacts from clause removal, never canonical.
            .replace(/\(\s+/g, "(")
            .replace(/\s+\)/g, ")")
            .replace(/[ \t]{2,}/g, " "),
    )
    .join("")
    .trim();
}

export function serialize(ast: LiqeQuery): string {
  return normalizeQueryString(liqeRawSerialize(ast));
}

export const EMPTY_AST: LiqeQuery = {
  type: "EmptyExpression",
  location: { start: 0, end: 0 },
};

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

const TOKEN_START_PRECEDERS = new Set([" ", "\t", "\n", "("]);

/**
 * Strip @ sigil and normalise NBSP. Both are silent failures: liqe rejects @
 * in field positions, treats NBSP as non-whitespace. Preserve quoted strings.
 */
export function stripAtSigils(text: string): string {
  // Replace any NBSP with regular space first — uniform treatment from
  // here on, and the @-strip pass needs to see the post-replacement chars.
  const normalized = text.replace(/\u00A0/g, " ");
  let out = "";
  let quoteChar = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charAt(i);
    if (quoteChar !== "") {
      out += ch;
      quoteChar = ch === quoteChar ? "" : quoteChar;
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += ch;
      quoteChar = ch;
      continue;
    }
    if (startsAToken(normalized, i)) {
      continue;
    }
    out += ch;
  }
  return out;
}

/** Whether the `@` at `index` opens a token, and so is the sigil rather than part of a value. */
function startsAToken(normalized: string, index: number): boolean {
  if (normalized.charAt(index) !== "@") return false;
  const prev = index === 0 ? void 0 : normalized[index - 1];

  return prev === void 0 || TOKEN_START_PRECEDERS.has(prev);
}

// Tiny LRU around `parse`. Per keystroke the SearchBar parses twice — once
// in `filterStore.applyQueryText` and once in the `filterHighlight`
// ProseMirror plugin. They pass the same raw text, so caching the last few
// inputs collapses both calls into a single liqe pass.
type ParseEntry = { ok: true; ast: LiqeQuery } | { ok: false; error: ParseError };
const PARSE_CACHE_LIMIT = 8;
const parseCache = new Map<string, ParseEntry>();

function cacheGet(key: string): ParseEntry | undefined {
  const entry = parseCache.get(key);
  if (!entry) {
    return void 0;
  }
  // Refresh recency.
  parseCache.delete(key);
  parseCache.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: ParseEntry): void {
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== void 0) {
      parseCache.delete(oldest);
    }
  }
  parseCache.set(key, entry);
}

export function parse(query: string): LiqeQuery {
  const trimmed = stripAtSigils(query).trim();
  if (trimmed.length === 0) {
    return EMPTY_AST;
  }
  const hit = cacheGet(trimmed);
  if (hit) {
    if (hit.ok) {
      return hit.ast;
    }
    throw hit.error;
  }
  try {
    const ast = liqeParse(trimmed);
    cacheSet(trimmed, { ok: true, ast });
    return ast;
  } catch (e) {
    const error =
      e instanceof LiqeSyntaxError
        ? new ParseError(e.message, e.offset)
        : new ParseError("Invalid query syntax — check for unmatched quotes or parentheses.");
    cacheSet(trimmed, { ok: false, error });
    throw error;
  }
}

export function isEmptyAST(ast: LiqeQuery): boolean {
  return ast.type === "EmptyExpression";
}
