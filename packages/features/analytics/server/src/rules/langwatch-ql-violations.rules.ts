/**
 * LangWatchQL analytics SQL — what a rejection says.
 * @see specs/analytics/lwql-api.feature
 */
import type { SqlSourcePosition } from "./langwatch-ql-parser.rules.ts";

/**
 * Why a query was refused. Each code names a cause the caller can act on differently, which is
 * the bar for a separate code — not one code per SQL keyword.
 */
export const LWQL_VIOLATION_CODES = [
  /** Nothing to run — no statement in the submitted text. */
  "EMPTY_QUERY",
  /** The text is not valid ClickHouse SQL. */
  "PARSE_FAILED",
  /** More than one statement was submitted. */
  "MULTIPLE_STATEMENTS",
  /** The statement is not a `SELECT` / `WITH … SELECT`. */
  "STATEMENT_NOT_ALLOWED",
  /** A `SETTINGS` clause appeared somewhere in the query. */
  "SETTINGS_CLAUSE",
  /** The query tried to choose the response format or write output. */
  "OUTPUT_CLAUSE",
  /** A reserved database (`system`, `information_schema`) was referenced. */
  "SCHEMA_NOT_ALLOWED",
  /** A table outside the caller's LangWatchQL schema was referenced. */
  "TABLE_NOT_ALLOWED",
  /** A table function was used as a source. */
  "TABLE_FUNCTION",
  /**
   * A function outside the allowlist was called. Its own code rather than `UNSUPPORTED_SYNTAX`
   * because the remedy differs: the query's *shape* is fine and one expression has to be
   * rewritten, which is a far shorter distance to travel than "this is not a read query".
   */
  "FUNCTION_NOT_ALLOWED",
  /** A restricted field was referenced. */
  "GATED_COLUMN",
  /** A wildcard column set was selected while restricted fields exist. */
  "WILDCARD_NOT_ALLOWED",
  /** Subqueries, CTEs, or expressions nested past the allowed depth. */
  "NESTING_TOO_DEEP",
  /** The default-deny fallthrough: syntax the validator does not recognise. */
  "UNSUPPORTED_SYNTAX",
] as const;

export type LangWatchQLViolationCode = (typeof LWQL_VIOLATION_CODES)[number];

/**
 * Where in the query the offending construct sits. The first eight are the expression positions
 * the content-gating policy enumerates.
 */
export const LWQL_CLAUSES = [
  "projection",
  "filter",
  "group",
  "order",
  "having",
  "join",
  "window",
  "subquery",
  "from",
  "with",
  "limit",
  "statement",
] as const;

export type LangWatchQLClause = (typeof LWQL_CLAUSES)[number];

/** One reason a query was refused. */
export interface LangWatchQLViolation {
  readonly code: LangWatchQLViolationCode;
  /** The clause the offending construct was found in. */
  readonly clause: LangWatchQLClause;
  /** Customer-safe sentence naming what to change. */
  readonly message: string;
  /** Where in the submitted SQL, when the parser reported a position. */
  readonly at?: SqlSourcePosition;
}

/**
 * How much caller-written text a message may quote back. Echoing the identifier is what makes a
 * rejection actionable — "table not available" without a name is useless to an agent fixing a
 * five-table query.
 */
const MAX_ECHOED_IDENTIFIER = 80;

/**
 * Characters that survive `\s` flattening but have no business in an echoed
 * identifier: C0/C1 controls, zero-width characters, and the bidi override
 * range, which would otherwise ride back into terminals and agent logs.
 */
const UNPRINTABLE =
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Quotes a caller-supplied identifier back at them, bounded and single-line. The bound counts
 * code points, not UTF-16 units.
 */
export function echoIdentifier(raw: string): string {
  const flattened = raw.replace(UNPRINTABLE, "").replace(/\s+/gu, " ").trim();
  const codePoints = Array.from(flattened);
  return codePoints.length > MAX_ECHOED_IDENTIFIER
    ? `${codePoints.slice(0, MAX_ECHOED_IDENTIFIER).join("")}…`
    : flattened;
}
