/**
 * Query-language parsing primitives. Wraps `liqe` with:
 *   - `@`-sigil + NBSP normalisation so the editor's UI affordances don't
 *     leak into the parser.
 *   - LRU cache so the SearchBar's two parse callsites (filterStore +
 *     filterHighlight) collapse into one liqe pass per keystroke.
 *   - `serialize` post-processing because liqe's own serializer occasionally
 *     emits strings its own parser then rejects.
 *
 * Syntax examples:
 *   status:error                    — exact match
 *   status:error AND model:gpt-4o   — boolean AND
 *   status:error OR model:gpt-4o    — boolean OR
 *   NOT status:error                — negation
 *   -status:error                   — negation (shorthand)
 *   (status:error OR status:warning) AND model:gpt-4o — grouping
 *   model:gpt*                      — wildcard
 *   cost:>0.01                      — comparison
 *   cost:[0.01 TO 1.00]             — range
 *   spans:>5                        — span count comparison
 *   "refund policy"                 — free-text search
 *   refund                          — unquoted free-text
 */

import {
  type LiqeQuery,
  SyntaxError as LiqeSyntaxError,
  parse as liqeParse,
  serialize as liqeRawSerialize,
} from "liqe";

/**
 * `liqe`'s serializer occasionally emits queries that its own parser then
 * rejects — most reliably the range form: `cost:[0.01 TO 1]AND foo:bar` (no
 * space between `]` and the next boolean operator). It also leaves runs of
 * whitespace intact when inner clauses are removed. Both round-trip into the
 * same `Invalid filter syntax` 422 from the backend.
 *
 * Normalise post-serialisation: insert a space between `]` / `)` and a
 * following `AND` / `OR` / `NOT`, and collapse adjacent whitespace.
 */
function normalizeQueryString(s: string): string {
  return s
    .replace(/([\]\)])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
    .replace(/\b(?:AND|OR|NOT)\b\s+/gi, (m) => m.replace(/\s+/g, " "))
    .replace(/[ \t]{2,}/g, " ")
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
 * Strip the `@` autocomplete trigger sigil before parsing AND normalise
 * U+00A0 NBSP → regular space. Both are silent failure modes:
 *   - `@` is the dropdown sigil; liqe doesn't accept it as a field-name
 *     prefix, so any stray `@` (e.g. typed before the interceptor caught
 *     up, or pasted in) would 422 the backend.
 *   - NBSP can leak in via clipboard pastes, IME, or rich-text auto-format
 *     of suggestion replacements. Liqe doesn't treat NBSP as whitespace,
 *     so `field:value\u00A0AND` parses as one Tag with value
 *     `value\u00A0AND` — silently fusing two clauses.
 *
 * Only strip `@` at token-start positions and outside quoted strings, so a
 * literal `@` inside a value like `"user@example.com"` is preserved.
 */
export function stripAtSigils(text: string): string {
  // Replace any NBSP with regular space first — uniform treatment from
  // here on, and the @-strip pass needs to see the post-replacement chars.
  const normalized = text.replace(/\u00A0/g, " ");
  let out = "";
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i] as string;
    if (inQuotes) {
      out += ch;
      if (ch === quoteChar) inQuotes = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += ch;
      inQuotes = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "@") {
      const prev = i === 0 ? undefined : normalized[i - 1];
      if (prev === undefined || TOKEN_START_PRECEDERS.has(prev)) continue;
    }
    out += ch;
  }
  return out;
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
  if (!entry) return undefined;
  // Refresh recency.
  parseCache.delete(key);
  parseCache.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: ParseEntry): void {
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  parseCache.set(key, entry);
}

export function parse(query: string): LiqeQuery {
  const trimmed = stripAtSigils(query).trim();
  if (trimmed.length === 0) return EMPTY_AST;
  const hit = cacheGet(trimmed);
  if (hit) {
    if (hit.ok) return hit.ast;
    throw hit.error;
  }
  try {
    const ast = liqeParse(trimmed);
    cacheSet(trimmed, { ok: true, ast });
    return ast;
  } catch (e) {
    const error =
      e instanceof LiqeSyntaxError
        ? new ParseError(e.message, (e as { offset?: number }).offset)
        : new ParseError(
            "Invalid query syntax — check for unmatched quotes or parentheses.",
          );
    cacheSet(trimmed, { ok: false, error });
    throw error;
  }
}

export function isEmptyAST(ast: LiqeQuery): boolean {
  return ast.type === "EmptyExpression";
}
