/**
 * LangWatchQL analytics SQL — what a caller is allowed to name.
 *
 * The data half of the gate: which tables exist for this caller, which fields
 * their permissions withhold, and how deep a query may nest. The behaviour half
 * is `validate.ts`.
 *
 * These values come from the schema catalog and the caller's permissions, both
 * resolved server-side from the authenticated context — never from the request
 * body, and never from the SQL text. This module only says what the shape is.
 *
 * @see specs/lwql/api.feature
 */

/**
 * Databases no LangWatchQL query may name, whatever the catalog says.
 *
 * The restricted database identity is granted `SELECT` on the LangWatchQL objects
 * and nothing else, so these are already unreachable at the database layer —
 * `system.*` exposes users, settings and other tenants' query history, and
 * ClickHouse's `information_schema` is a view over the same metadata. They are
 * listed here so the refusal happens at the gateway with a message the caller
 * can act on, rather than as a permission error from a layer whose vocabulary
 * we do not want to relay.
 *
 * Matched case-insensitively: ClickHouse exposes `information_schema` under
 * both that spelling and `INFORMATION_SCHEMA`, and they are the same database.
 */
export const RESERVED_DATABASES: readonly string[] = [
  "system",
  "information_schema",
];

/** Nesting ceilings. Both refuse with `NESTING_TOO_DEEP`. */
export interface LangWatchQLLimits {
  /**
   * Deepest subquery or CTE nesting allowed; the submitted statement is depth
   * 0, so `1` permits `SELECT … (SELECT …)` and refuses one level further.
   */
  readonly maxSubqueryDepth: number;
  /**
   * Deepest the walk will descend into the parsed tree, counting every node
   * rather than only queries.
   *
   * Bounds the walker's own recursion rather than the query's cost — a tree
   * nested past this refuses instead of risking a stack overflow in the
   * gateway, which would surface as an unknown 500 for what is really a
   * rejected query.
   */
  readonly maxNodeDepth: number;
}

/**
 * Ceilings for the shipped API.
 *
 * Eight levels of subquery nesting covers every analytical shape the issue
 * enumerates (period-over-period comparisons, rolling windows, first-event-per-
 * trace) with headroom. The node ceiling sits far above what those shapes reach
 * — a query at the subquery ceiling costs roughly 150 levels of tree — and far
 * below the JavaScript stack, so it only ever fires on pathological input.
 */
export const DEFAULT_LWQL_LIMITS: LangWatchQLLimits = {
  maxSubqueryDepth: 8,
  maxNodeDepth: 400,
};

/** What this caller may reference. */
export interface LangWatchQLPolicy {
  /**
   * Table references the caller may name, each `table` or `database.table`.
   *
   * A reference must match an entry exactly, case-insensitively, after both
   * sides are qualified with {@link LangWatchQLPolicy.defaultDatabase}. CTE
   * names are not checked against this list — a `WITH` name resolves to its own
   * subquery, which the walk validates on its own terms.
   */
  readonly allowedTables: readonly string[];
  /**
   * Fields the caller's permissions withhold, matched case-insensitively
   * against every dotted segment of a column reference — not only the last —
   * so `gated.sub` and `t.gated.sub` are refused along with `t.gated`.
   *
   * When this is non-empty the walk also refuses wildcard column sets, because
   * it cannot prove `*` excludes a withheld field without the table's columns.
   */
  readonly gatedColumns: readonly string[];
  /**
   * Content permissions the caller *holds*, which is the positive form of
   * {@link LangWatchQLPolicy.gatedColumns}.
   *
   * Both are needed, and they are not redundant. A column is gated when its own
   * declared gates are not all held, so the withheld *set* is all the walk
   * needs to refuse a column reference. An app function has no column to look
   * up: what the walk has to answer is "does this caller hold `input` and
   * `output`", and a list of withheld column names cannot answer it — a
   * deployment whose catalog happened to expose no output-gated column would
   * produce an empty withheld set and admit every function.
   *
   * Fail-closed like the derivation it comes from: an unresolved `Protections`
   * holds nothing, so every gated function is refused rather than admitted.
   */
  readonly heldPermissions?: readonly string[];
  /**
   * Whether this caller may call an eval function.
   *
   * Its own field rather than another entry in
   * {@link LangWatchQLPolicy.heldPermissions}, because it is not a permission:
   * it is a product flag on the project **and** the presence of a classifier on
   * the deployment, resolved together by
   * `~/server/app-layer/instant-evals/access.ts`. Folding it into the
   * permission set would let a caller's redaction protections decide whether a
   * feature exists.
   *
   * Absent means off, so a caller that never asks the question never gets the
   * functions — which is the right default for the save path, where a statement
   * is being stored rather than run.
   */
  readonly instantEvalsEnabled?: boolean;
  /**
   * Database an unqualified table name resolves to — the same one the executor
   * connects with. Omit it and unqualified names are matched as written.
   */
  readonly defaultDatabase?: string;
  /** Defaults to {@link DEFAULT_LWQL_LIMITS}. */
  readonly limits?: LangWatchQLLimits;
  /**
   * The columns of each view in {@link allowedTables}, keyed the same way
   * (`table` or `database.table`, qualified against {@link defaultDatabase}
   * the same way a reference is).
   *
   * Optional, and absent entries are expected: this is what turns a
   * `GATED_COLUMN` refusal into one naming the view's actual columns rather
   * than a bare "not available", and a caller that has not wired the catalog
   * through yet loses nothing but that enrichment.
   */
  readonly viewColumns?: Readonly<Record<string, readonly string[]>>;
}

/** The policy in the form the walk compares against: lowercased and set-shaped. */
export interface ResolvedLangWatchQLPolicy {
  readonly allowedTables: ReadonlySet<string>;
  readonly gatedColumns: ReadonlySet<string>;
  readonly heldPermissions: ReadonlySet<string>;
  readonly instantEvalsEnabled: boolean;
  readonly reservedDatabases: ReadonlySet<string>;
  readonly defaultDatabase: string;
  readonly limits: LangWatchQLLimits;
  /** {@link LangWatchQLPolicy.allowedTables}, sorted and deduplicated, for display in a refusal's `meta`. */
  readonly availableViews: readonly string[];
  /** {@link LangWatchQLPolicy.viewColumns}, qualified the same way {@link allowedTables} is. */
  readonly viewColumns: ReadonlyMap<string, readonly string[]>;
}

/**
 * `database.table`, lowercased, with `defaultDatabase` filled in when the
 * reference or the catalog entry omitted one.
 *
 * Both sides of every comparison go through here, so a catalog listing
 * `analytics.traces` matches a caller writing `traces` exactly when the
 * executor's default database is `analytics` — and never otherwise.
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

/** Normalises a policy once, before the walk. */
export function resolveLangWatchQLPolicy(
  policy: LangWatchQLPolicy,
): ResolvedLangWatchQLPolicy {
  const defaultDatabase = policy.defaultDatabase?.trim().toLowerCase() ?? "";
  return {
    allowedTables: new Set(
      policy.allowedTables.map((entry) =>
        qualifyTableName({ table: entry, defaultDatabase }),
      ),
    ),
    gatedColumns: new Set(
      policy.gatedColumns.map((column) => column.trim().toLowerCase()),
    ),
    heldPermissions: new Set(policy.heldPermissions ?? []),
    instantEvalsEnabled: policy.instantEvalsEnabled === true,
    reservedDatabases: new Set(RESERVED_DATABASES),
    defaultDatabase,
    limits: policy.limits ?? DEFAULT_LWQL_LIMITS,
    availableViews: [
      ...new Set(policy.allowedTables.map((entry) => entry.trim())),
    ].sort((left, right) => left.localeCompare(right)),
    viewColumns: new Map(
      Object.entries(policy.viewColumns ?? {}).map(([table, columns]) => [
        qualifyTableName({ table, defaultDatabase }),
        [...new Set(columns.map((column) => column.trim()))].sort(
          (left, right) => left.localeCompare(right),
        ),
      ]),
    ),
  };
}
