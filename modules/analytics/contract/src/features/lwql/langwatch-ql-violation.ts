/**
 * LangWatchQL analytics SQL — what a rejection says.
 * @see specs/lwql/api.feature
 */
export interface SqlSourcePosition {
  readonly line: number;
  readonly column: number;
}

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
  /** A wildcard column set was referenced, in any position, while restricted fields exist. */
  "WILDCARD_NOT_ALLOWED",
  /**
   * The statement's own top-level `LIMIT` asks for more rows than one request may return. The
   * cap and how to page under it ride on the violation (`maxRows`, `hint`).
   */
  "LIMIT_TOO_HIGH",
  /** A `UNION` branch names no `LIMIT` of its own, so no appended default can bound it. */
  "LIMIT_REQUIRED_PER_BRANCH",
  /** Subqueries, CTEs, or expressions nested past the allowed depth. */
  "NESTING_TOO_DEEP",
  /** The default-deny fallthrough: syntax the validator does not recognise. */
  "UNSUPPORTED_SYNTAX",
  /**
   * An app function was called somewhere other than the top-level SELECT list.
   * The database holds each one as a projection UDF over its key, so a call in
   * a WHERE compares the raw key and answers the wrong rows with no error.
   */
  "APP_FUNCTION_POSITION",
  /**
   * An app function was called without an alias. Required so hydration can
   * find the call by its output column name.
   */
  "APP_FUNCTION_ALIAS_REQUIRED",
  /** An app function's arguments do not match its one signature. */
  "APP_FUNCTION_ARGUMENT",
  /** An app function was called without the permissions it requires. */
  "APP_FUNCTION_GATED",
  /**
   * An app function was called with a spelling other than the catalogued one.
   * The statement runs verbatim and ClickHouse resolves a UDF by exact name.
   */
  "APP_FUNCTION_NAME_CASE",
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
  /** A code-keyed corrective sentence on every violation: the floor under the sharper fields. */
  readonly hint: string;
  /** The complete function allowlist, on `FUNCTION_NOT_ALLOWED` and no other code. */
  readonly allowedFunctions?: readonly string[];
  /** The views the caller may reference, on a `TABLE_NOT_ALLOWED` that named a view. */
  readonly availableViews?: readonly string[];
  /** The view a `GATED_COLUMN` field was read from, when exactly one table resolves. */
  readonly view?: string;
  /** The columns of `view` the caller may reference, when the policy carries them. */
  readonly availableColumns?: readonly string[];
  /** The row cap a `LIMIT_TOO_HIGH` or `LIMIT_REQUIRED_PER_BRANCH` refusal names. */
  readonly maxRows?: number;
}
