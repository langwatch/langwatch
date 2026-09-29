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
  return parseWithApostrophes(query);
}

/** Stands in for an in-word apostrophe while liqe parses, which would read it as a quote. */
const APOSTROPHE_STAND_IN = "\uE000";
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Whether the `'` at `index` belongs to a word (doesn't, member's, members')
 * rather than opening or closing a single-quoted value. Outside quotes it
 * follows a letter or digit; inside one it also has one on its right.
 */
export function isWordApostrophe({
  text,
  index,
  inSingleQuotes,
}: {
  text: string;
  index: number;
  inSingleQuotes: boolean;
}): boolean {
  if (text.charAt(index) !== "'") return false;
  const before = WORD_CHAR.test(text.charAt(index - 1));
  if (!inSingleQuotes) return before;
  return before && WORD_CHAR.test(text.charAt(index + 1));
}

function maskWordApostrophes(text: string): string {
  let out = "";
  let quoteChar = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\\" && quoteChar) {
      out += ch + text.charAt(i + 1);
      i += 1;
      continue;
    }
    if (isWordApostrophe({ text, index: i, inSingleQuotes: quoteChar === "'" })) {
      out += quoteChar === '"' ? ch : APOSTROPHE_STAND_IN;
      continue;
    }
    quoteChar = nextQuoteChar({ ch, quoteChar });
    out += ch;
  }
  return out;
}

/** The open quote after `ch`: opened, closed, or unchanged. */
function nextQuoteChar({ ch, quoteChar }: { ch: string; quoteChar: string }): string {
  if (ch !== '"' && ch !== "'") return quoteChar;
  if (!quoteChar) return ch;
  return ch === quoteChar ? "" : quoteChar;
}

function restoreApostrophes<T>(node: T): T {
  if (typeof node === "string") {
    return node.replaceAll(APOSTROPHE_STAND_IN, "'") as T;
  }
  if (Array.isArray(node)) return node.map(restoreApostrophes) as T;
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = restoreApostrophes(record[key]);
  }
  return node;
}

/** liqe, reading an in-word apostrophe as a letter. @see specs/traces-v2/search.feature */
function parseWithApostrophes(query: string): LiqeQuery {
  const masked = maskWordApostrophes(query);
  const ast = liqeParse(masked);
  return masked === query ? ast : restoreApostrophes(ast);
}

/**
 * Fix liqe serializer output that its own parser rejects (missing space after
 * `]`/`)` before boolean ops, stray whitespace in parens). Normalise
 * post-serialisation while preserving quoted strings.
 */
function splitOnQuotes(s: string): { text: string; quoted: boolean }[] {
  const segments: { text: string; quoted: boolean }[] = [];
  let buf = "";
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (quoteChar) {
      buf += ch;
      const inWord = isWordApostrophe({ text: s, index: i, inSingleQuotes: quoteChar === "'" });
      if (ch === quoteChar && s[i - 1] !== "\\" && !inWord) {
        segments.push({ text: buf, quoted: true });
        buf = "";
        quoteChar = "";
      }
    } else if (
      (ch === '"' || ch === "'") &&
      !isWordApostrophe({ text: s, index: i, inSingleQuotes: false })
    ) {
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
      const closes =
        ch === quoteChar &&
        !isWordApostrophe({ text: normalized, index: i, inSingleQuotes: quoteChar === "'" });
      quoteChar = closes ? "" : quoteChar;
      continue;
    }
    if (
      (ch === '"' || ch === "'") &&
      !isWordApostrophe({ text: normalized, index: i, inSingleQuotes: false })
    ) {
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

function findCachedParse(key: string): ParseEntry | undefined {
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
  const hit = findCachedParse(trimmed);
  if (hit) {
    if (hit.ok) {
      return hit.ast;
    }
    throw hit.error;
  }
  try {
    const ast = parseWithApostrophes(trimmed);
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
