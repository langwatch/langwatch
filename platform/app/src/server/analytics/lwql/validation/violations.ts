/**
 * LangWatchQL analytics SQL — what a rejection says.
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
 * @see specs/lwql/api.feature
 */
import type { SqlSourcePosition } from "./parser";

/**
 * Why a query was refused.
 *
 * Each code names a cause the caller can act on differently, which is the bar
 * for a separate code — not one code per SQL keyword. Writes, DDL and role
 * changes all land on {@link LWQL_VIOLATION_CODES `STATEMENT_NOT_ALLOWED`}
 * because the remedy is identical: send a SELECT instead.
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
   * A function outside the allowlist was called.
   *
   * Its own code rather than `UNSUPPORTED_SYNTAX` because the remedy differs:
   * the query's *shape* is fine and one expression has to be rewritten, which
   * is a far shorter distance to travel than "this is not a read query".
   */
  "FUNCTION_NOT_ALLOWED",
  /** A restricted field was referenced. */
  "GATED_COLUMN",
  /** A wildcard column set was referenced, in any position, while restricted fields exist. */
  "WILDCARD_NOT_ALLOWED",
  /**
   * The statement's own top-level `LIMIT` asks for more rows than one request
   * may return.
   *
   * Its own code rather than `UNSUPPORTED_SYNTAX` because the remedy is precise
   * and mechanical: lower the `LIMIT` to the cap and page the rest with
   * `LIMIT`/`OFFSET` and an `ORDER BY`. The cap and that advice ride on the
   * violation (`maxRows`, `hint`).
   */
  "LIMIT_TOO_HIGH",
  /**
   * A `UNION` branch names no `LIMIT` of its own.
   *
   * Each branch of a `UNION` runs and returns independently, so a default
   * `LIMIT` appended once to the whole statement cannot bound a branch that
   * lacks one — the append is refused for any statement with more than one
   * top-level branch, and every branch must name its own bounded `LIMIT`.
   */
  "LIMIT_REQUIRED_PER_BRANCH",
  /** Subqueries, CTEs, or expressions nested past the allowed depth. */
  "NESTING_TOO_DEEP",
  /** The default-deny fallthrough: syntax the validator does not recognise. */
  "UNSUPPORTED_SYNTAX",
  /**
   * An app function was called somewhere other than the top-level SELECT list.
   *
   * Its own code, and the one refusal in this list that is a *correctness*
   * rule rather than a policy one. The database holds each app function as a
   * projection UDF over its key, so ClickHouse will happily evaluate
   * `WHERE conversation(ConversationId) = 'x'` and compare the raw
   * conversation id — answering with the wrong rows rather than with an error.
   * Nothing downstream can detect that, so the refusal has to happen here.
   */
  "APP_FUNCTION_POSITION",
  /**
   * An app function was called without an alias.
   *
   * Required so the hydration stage can find the call by output column name.
   * Without one the column is named after the call text itself, quoting and
   * all, and locating it would mean parsing a column name back into a call.
   */
  "APP_FUNCTION_ALIAS_REQUIRED",
  /** An app function's arguments do not match its one signature. */
  "APP_FUNCTION_ARGUMENT",
  /** An app function was called without the permissions it requires. */
  "APP_FUNCTION_GATED",
  /**
   * An app function was called with a spelling other than the catalogued one.
   *
   * The statement is never rewritten and ClickHouse resolves a SQL UDF by its
   * exact name, so `CONVERSATION(x)` would reach the database as an unknown
   * function. The name is recognised here anyway, case-insensitively, so the
   * refusal can name the spelling to use instead of reporting a function the
   * caller can see in the schema as not allowed.
   */
  "APP_FUNCTION_NAME_CASE",
] as const;

export type LangWatchQLViolationCode = (typeof LWQL_VIOLATION_CODES)[number];

/**
 * Where in the query the offending construct sits.
 *
 * The first eight are the expression positions the content-gating policy
 * enumerates. `subquery` wins over the others: a reference inside any nested
 * query reports `subquery`, so the eight are mutually exclusive and a consumer
 * can branch on exactly one.
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
  /**
   * A generic, code-keyed corrective sentence, present on every violation.
   *
   * The bar this API holds itself to: a caller — usually an agent with no
   * UI — never receives a refusal with nothing to act on. The more specific
   * fields below (`allowedFunctions`, `availableViews`,
   * `availableColumns`) are the sharper answer where one is resolvable;
   * `hint` is the floor every code clears regardless.
   */
  readonly hint: string;
  /**
   * The complete function allowlist a query may call.
   *
   * The validator attaches it structurally to `FUNCTION_NOT_ALLOWED` and to no
   * other code (see `report` in `./validate.ts`, which derives it from the code
   * rather than taking it as an argument), so it is present on exactly the
   * refusal it helps and absent everywhere else. A refused caller — usually an
   * agent with no UI — recovers from what it should have called without a
   * second round trip to `GET /api/v1/query/schema`.
   */
  readonly allowedFunctions?: readonly string[];
  /**
   * The view names the caller may reference, attached to `TABLE_NOT_ALLOWED`
   * when a written name failed to resolve — never to the bound-parameter
   * variant of that code, which named no view to correct.
   */
  readonly availableViews?: readonly string[];
  /**
   * The view a `GATED_COLUMN` refusal's field was read from, when the walk
   * could resolve it to exactly one table in scope.
   */
  readonly view?: string;
  /**
   * The columns of {@link view} the caller may reference, attached
   * alongside it when the policy carries column data for that view.
   */
  readonly availableColumns?: readonly string[];
  /**
   * The row cap a `LIMIT_TOO_HIGH` refusal names — the largest `LIMIT` one
   * request may carry. Attached to that code alone, so a refused caller learns
   * the ceiling to page under without a second round trip.
   */
  readonly maxRows?: number;
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

/**
 * Quotes a caller-supplied identifier back at them, bounded and single-line.
 *
 * The bound counts code points, not UTF-16 units. `slice` would cut an astral
 * character — an emoji, a CJK extension B ideograph — in half and send the
 * leading surrogate on alone through `message` and `meta.violations`, which is
 * the very output this bound exists to keep well-formed.
 */
export function echoIdentifier(raw: string): string {
  const flattened = raw.replace(UNPRINTABLE, "").replace(/\s+/gu, " ").trim();
  const codePoints = Array.from(flattened);
  return codePoints.length > MAX_ECHOED_IDENTIFIER
    ? `${codePoints.slice(0, MAX_ECHOED_IDENTIFIER).join("")}…`
    : flattened;
}
