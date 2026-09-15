/**
 * LangWatchQL analytics SQL — what a caller is allowed to name.
 * @see specs/analytics/lwql-api.feature
 */

/**
 * Databases no LangWatchQL query may name, whatever the catalog says.
 */
export const RESERVED_DATABASES: readonly string[] = ["system", "information_schema"];

/** Nesting ceilings. Both refuse with `NESTING_TOO_DEEP`. */
export interface LangWatchQLLimits {
  /**
   * Deepest subquery or CTE nesting allowed; the submitted statement is depth
   * 0, so `1` permits `SELECT … (SELECT …)` and refuses one level further.
   */
  readonly maxSubqueryDepth: number;
  /**
   * Deepest the walk will descend into the parsed tree, counting every node rather than only
   * queries.
   */
  readonly maxNodeDepth: number;
}

/**
 * Ceilings for the shipped API. Eight levels of subquery nesting covers every analytical shape
 * the issue enumerates (period-over-period comparisons, rolling windows, first-event-per-
 * trace) with headroom.
 */
export const DEFAULT_LWQL_LIMITS: LangWatchQLLimits = {
  maxSubqueryDepth: 8,
  maxNodeDepth: 400,
};

/** What this caller may reference. */
export interface LangWatchQLPolicy {
  /**
   * Table references the caller may name, each `table` or `database.table`. A reference must
   * match an entry exactly, case-insensitively, after both sides are qualified with {@link
   * LangWatchQLPolicy.defaultDatabase}.
   */
  readonly allowedTables: readonly string[];
  /**
   * Fields the caller's permissions withhold, matched case-insensitively against the last
   * segment of a column reference (`t.body` matches `body`).
   */
  readonly gatedColumns: readonly string[];
  /**
   * Database an unqualified table name resolves to — the same one the executor
   * connects with. Omit it and unqualified names are matched as written.
   */
  readonly defaultDatabase?: string;
  /** Defaults to {@link DEFAULT_LWQL_LIMITS}. */
  readonly limits?: LangWatchQLLimits;
}

/** The policy in the form the walk compares against: lowercased and set-shaped. */
export interface ResolvedLangWatchQLPolicy {
  readonly allowedTables: ReadonlySet<string>;
  readonly gatedColumns: ReadonlySet<string>;
  readonly reservedDatabases: ReadonlySet<string>;
  readonly defaultDatabase: string;
  readonly limits: LangWatchQLLimits;
}

/**
 * `database.table`, lowercased, with `defaultDatabase` filled in when the reference or the
 * catalog entry omitted one.
 */
export function qualifyTableName({
  table,
  database,
  defaultDatabase,
}: {
  table: string;
  database?: string;
  defaultDatabase: string;
}): string {
  const trimmed = table.trim().toLowerCase();
  const explicit = database?.trim().toLowerCase();
  if (explicit) return `${explicit}.${trimmed}`;
  if (trimmed.includes(".")) return trimmed;
  return defaultDatabase ? `${defaultDatabase}.${trimmed}` : trimmed;
}
