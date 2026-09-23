import type { LangWatchQLViolationCode } from "@langwatch/analytics-contract";
import { LWQL_MAX_RESULT_ROWS } from "@langwatch/analytics-contract/langwatch-ql-limits";

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

const MAX_ROWS_TEXT = LWQL_MAX_RESULT_ROWS.toLocaleString("en-US");

/**
 * The floor every violation code clears: a corrective sentence keyed on the code alone. A
 * `Record` over the whole union, so a code added without a hint fails the build.
 */
export const DEFAULT_VIOLATION_HINTS: Readonly<Record<LangWatchQLViolationCode, string>> = {
  EMPTY_QUERY: "Submit a single SELECT statement.",
  PARSE_FAILED: "Check the SQL against standard ClickHouse SELECT syntax and try again.",
  MULTIPLE_STATEMENTS: "Submit exactly one SELECT statement per request.",
  STATEMENT_NOT_ALLOWED: "Rewrite the request as a single SELECT (or WITH … SELECT) statement.",
  SETTINGS_CLAUSE: "Remove the SETTINGS clause — result limits are applied automatically.",
  OUTPUT_CLAUSE: "Remove the output/format clause — this API controls the response format.",
  SCHEMA_NOT_ALLOWED:
    "Query one of the analytics views listed by GET /api/v1/query/schema instead.",
  TABLE_NOT_ALLOWED:
    "Use one of the views named in this violation's availableViews, or listed by GET /api/v1/query/schema.",
  TABLE_FUNCTION:
    "Read from one of the analytics views listed by GET /api/v1/query/schema instead of a table function.",
  FUNCTION_NOT_ALLOWED:
    "Rewrite the expression using one of the functions named in this violation's allowedFunctions.",
  LIMIT_TOO_HIGH: `Lower the LIMIT to ${MAX_ROWS_TEXT} rows or fewer, and page the rest with LIMIT/OFFSET and an ORDER BY.`,
  LIMIT_REQUIRED_PER_BRANCH: `Add a LIMIT of ${MAX_ROWS_TEXT} rows or fewer to every branch of the UNION.`,
  GATED_COLUMN:
    "Remove the field, or use one of the columns named in this violation's availableColumns.",
  WILDCARD_NOT_ALLOWED: "List the fields you need by name instead of using a wildcard.",
  NESTING_TOO_DEEP: "Flatten the query — reduce subquery, CTE, or expression nesting.",
  UNSUPPORTED_SYNTAX: "Rewrite the query as a plain read query over the analytics views.",
  APP_FUNCTION_POSITION:
    "Call the function as an aliased entry of the top-level SELECT list, and filter or group on the key column instead.",
  APP_FUNCTION_ALIAS_REQUIRED:
    "Give the call an alias, for example conversation(ConversationId) AS transcript.",
  APP_FUNCTION_ARGUMENT:
    "Match the signature listed for this function by GET /api/v1/query/schema.",
  APP_FUNCTION_GATED:
    "Remove the call, or use a key that holds the permissions this function names.",
  APP_FUNCTION_NAME_CASE: "Write the function name exactly as GET /api/v1/query/schema spells it.",
};
