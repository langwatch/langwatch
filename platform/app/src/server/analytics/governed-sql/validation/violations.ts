/**
 * Governed analytics SQL — what a rejection says.
 *
 * A violation is the machine-readable half of a refusal: a stable `code` naming
 * the cause, the `clause` it was found in, and a sentence written for whoever
 * has to fix the SQL — which, on this API, is usually an agent with no UI.
 *
 * Every message here is customer-safe by construction. None of them names an
 * internal table, a server setting, a host, a database identity, or the
 * existence of another tenant; the only caller-supplied text any of them
 * carries is an identifier the caller wrote themselves, length-capped.
 *
 * @see specs/analytics/governed-sql-api.feature
 */
import type { SqlSourcePosition } from "./parser";

/**
 * Why a query was refused.
 *
 * Each code names a cause the caller can act on differently, which is the bar
 * for a separate code — not one code per SQL keyword. Writes, DDL and role
 * changes all land on {@link GOVERNED_SQL_VIOLATION_CODES `STATEMENT_NOT_ALLOWED`}
 * because the remedy is identical: send a SELECT instead.
 */
export const GOVERNED_SQL_VIOLATION_CODES = [
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
  /** A table outside the caller's governed schema was referenced. */
  "TABLE_NOT_ALLOWED",
  /** A table function was used as a source. */
  "TABLE_FUNCTION",
  /**
   * A function outside the allowlist was called.
   *
   * Its own code rather than `UNSUPPORTED_SYNTAX` because the remedy differs:
   * the query's *shape* is fine and one expression has to be rewritten, which
   * is a far shorter distance to travel than "this is not a read query".
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

export type GovernedSqlViolationCode =
  (typeof GOVERNED_SQL_VIOLATION_CODES)[number];

/**
 * Where in the query the offending construct sits.
 *
 * The first eight are the expression positions the content-gating policy
 * enumerates. `subquery` wins over the others: a reference inside any nested
 * query reports `subquery`, so the eight are mutually exclusive and a consumer
 * can branch on exactly one.
 */
export const GOVERNED_SQL_CLAUSES = [
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

export type GovernedSqlClause = (typeof GOVERNED_SQL_CLAUSES)[number];

/** One reason a query was refused. */
export interface GovernedSqlViolation {
  readonly code: GovernedSqlViolationCode;
  /** The clause the offending construct was found in. */
  readonly clause: GovernedSqlClause;
  /** Customer-safe sentence naming what to change. */
  readonly message: string;
  /** Where in the submitted SQL, when the parser reported a position. */
  readonly at?: SqlSourcePosition;
}

/**
 * How much caller-written text a message may quote back.
 *
 * Echoing the identifier is what makes a rejection actionable — "table not
 * available" without a name is useless to an agent fixing a five-table query.
 * A backtick-quoted ClickHouse identifier can hold arbitrary text, though, so
 * the echo is bounded rather than trusted to be short.
 */
const MAX_ECHOED_IDENTIFIER = 80;

/**
 * Characters that survive `\s` flattening but have no business in an echoed
 * identifier: C0/C1 controls (ANSI escapes), zero-width characters, and the
 * bidi override range — any of which a backtick-quoted ClickHouse identifier
 * can carry, and which would otherwise ride back into terminals and agent
 * logs through `message` and `meta.violations`.
 */
const UNPRINTABLE =
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** Quotes a caller-supplied identifier back at them, bounded and single-line. */
export function echoIdentifier(raw: string): string {
  const flattened = raw.replace(UNPRINTABLE, "").replace(/\s+/gu, " ").trim();
  return flattened.length > MAX_ECHOED_IDENTIFIER
    ? `${flattened.slice(0, MAX_ECHOED_IDENTIFIER)}…`
    : flattened;
}
