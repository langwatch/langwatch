/**
 * The language the editor offers beyond the member's schema: SQL keywords and
 * the ClickHouse functions the governed surface most often needs.
 *
 * These are editor assistance only — the server's validator remains the policy.
 * The lists are reviewed, not exhaustive: a keyword here must be one the
 * governed endpoint can actually accept in a read-only SELECT, so nothing DDL,
 * nothing mutating, and no session or system clause is ever suggested.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

/** What kind of language entry a suggestion is. */
export type GovernedSqlLanguageKind = "keyword" | "function";

/** One language entry of the editor's completion list. */
export interface GovernedSqlLanguageItem {
  readonly label: string;
  readonly kind: GovernedSqlLanguageKind;
  /** The short right-hand annotation shown beside the suggestion. */
  readonly detail: string;
}

/** The clauses and operators of a governed read-only SELECT. */
const KEYWORDS: readonly string[] = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "DISTINCT",
  "JOIN",
  "LEFT JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "ON",
  "USING",
  "UNION ALL",
  "WITH",
  "ASC",
  "DESC",
  "INTERVAL",
];

/** ClickHouse functions a governed analytics query most often reaches for. */
const FUNCTIONS: readonly string[] = [
  "count",
  "countIf",
  "sum",
  "sumIf",
  "avg",
  "avgIf",
  "min",
  "max",
  "uniq",
  "uniqExact",
  "quantile",
  "median",
  "groupArray",
  "groupUniqArray",
  "now",
  "today",
  "yesterday",
  "toDate",
  "toDateTime",
  "toStartOfMinute",
  "toStartOfHour",
  "toStartOfDay",
  "toStartOfWeek",
  "toStartOfMonth",
  "subtractMinutes",
  "subtractHours",
  "subtractDays",
  "addDays",
  "dateDiff",
  "formatDateTime",
  "round",
  "floor",
  "ceil",
  "abs",
  "coalesce",
  "ifNull",
  "nullIf",
  "if",
  "multiIf",
  "lower",
  "upper",
  "concat",
  "substring",
  "length",
  "position",
  "arrayJoin",
  "has",
  "empty",
  "notEmpty",
  "toString",
  "toInt64",
  "toFloat64",
  "JSONExtractString",
  "JSONExtractInt",
  "JSONExtractFloat",
];

/**
 * Every language suggestion the editor offers, keywords before functions.
 * Static by construction — nothing here reads the schema or the network.
 */
export const GOVERNED_SQL_LANGUAGE_ITEMS: readonly GovernedSqlLanguageItem[] = [
  ...KEYWORDS.map(
    (label): GovernedSqlLanguageItem => ({
      label,
      kind: "keyword",
      detail: "keyword",
    }),
  ),
  ...FUNCTIONS.map(
    (label): GovernedSqlLanguageItem => ({
      label,
      kind: "function",
      detail: "function",
    }),
  ),
];
