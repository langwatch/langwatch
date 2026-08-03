/**
 * Governed analytics SQL — the `analytics.*` views, as SQL text.
 *
 * `provisioning.ts` builds the access model (who the restricted identity is,
 * what it may change, which rows it may see). This module builds the objects
 * that model is applied to: one normal view per catalog entry over the real
 * fact tables, the column grants that bound what those views may read, and the
 * row policies that bound which rows they return.
 *
 * Everything here is generated from `./catalog/`, so the exposed surface is the
 * catalog and nothing else. A column that is not in the catalog is not in the
 * grant, which under ClickHouse's column-level access means unreachable rather
 * than merely unselected.
 *
 * ## Three properties that are not negotiable
 *
 * **`SQL SECURITY INVOKER`, always, and never `MATERIALIZED`.** A view reading
 * its sources as its *definer* is not subject to the caller's row policies —
 * measured against 25.10.2.65, a `DEFINER` view over a policed table returned
 * both tenants' rows to the restricted identity. `MATERIALIZED VIEW` defaults
 * to `DEFINER`, which is why the audit
 * (`definerViewAuditQuery`) reports it as an offender rather than trusting that
 * nobody will write one.
 *
 * **The row policy goes on the source table, not on the view.** An `INVOKER`
 * view reads its source as the caller, so the policy on the source is what
 * bounds it — and it bounds the source itself in the same motion, which is the
 * property the isolation proof needs: a caller that somehow names the physical
 * table is still scoped.
 *
 * **The policy applies `TO` the restricted identity only.** The application's
 * own reads and the migration path must be untouched by anything here.
 *
 * ## What the column grant can and cannot do
 *
 * It bounds *columns*. It cannot bound keys inside a `Map` column, and an
 * `INVOKER` view only works if the caller holds a grant on every source column
 * the view body reads — so the restricted identity necessarily holds
 * `SELECT(SpanAttributes)` on the span table, and a caller who names that table
 * directly reads the map unfiltered (still tenant-scoped, because the row
 * policy is on the source). The gateway's `allowedTables` is what keeps the
 * physical table unnameable. See the module comment in
 * `./catalog/contentGating.ts` for how the views themselves strip content keys.
 *
 * @see ./catalog/governedViews.ts — the catalog these statements are built from
 * @see ./provisioning.ts — the access model applied over them
 * @see specs/analytics/governed-sql-api.feature
 */

import { GOVERNED_VIEW_CATALOG } from "./catalog/governedViews";
import {
  columnExpression,
  type GovernedViewDefinition,
  governedViewSourceColumns,
} from "./catalog/types";
import {
  type GovernedSqlNames,
  type GovernedTable,
  governedGrantStatement,
  governedRowPolicyStatement,
} from "./provisioning";

/**
 * How a view collapses a `ReplacingMergeTree`'s versions to one row.
 *
 * A choice with a measurement behind it rather than a preference, so it is a
 * parameter: the isolation suite measures each against the real tables and the
 * shipped default is whichever won. See
 * `__tests__/governedViews.integration.test.ts`.
 *
 *  - `in-tuple` — the repository pattern from
 *    `dev/docs/best_practices/clickhouse-queries.md`: an `IN` over
 *    `(keys…, max(version))`. Correct, and the inner scope carries no predicate
 *    from the caller's query, so it reads the tenant's whole history on every
 *    query however narrow the caller's time filter is.
 *  - `final` — `FROM … FINAL`. The caller's `WHERE` reaches the read, so a time
 *    predicate prunes partitions in the only scope there is.
 *  - `none` — no deduplication. Exposes every unmerged version as its own row,
 *    which silently doubles aggregates. Here to be measured against, never to
 *    be shipped.
 */
export type GovernedDedupStrategy = "in-tuple" | "final" | "none";

/**
 * The strategy the shipped views use.
 *
 * Set by measurement, not by preference. Against `trace_summaries` carrying
 * 4,004 rows for two tenants across eight weekly partitions, on
 * 25.10.2.65, reading as the restricted identity (`read_rows` from
 * `system.query_log`):
 *
 * | strategy   | whole history | one week | rows returned |
 * | ---------- | ------------- | -------- | ------------- |
 * | `none`     | 4,006         | 502      | 2,002 (dupe)  |
 * | `in-tuple` | 8,012         | 4,508    | 2,001         |
 * | `final`    | 4,006         | 502      | 2,001         |
 *
 * The `in-tuple` row is the finding. Its filtered read costs 4,508 because only
 * the *outer* scope prunes: the `max()` subquery carries no predicate from the
 * caller's query and has no way to receive one, so it reads the tenant's whole
 * history on every query — and a narrow one-week question costs more than
 * reading the entire table undeduplicated. That is the shape
 * `dev/docs/best_practices/clickhouse-queries.md` prescribes for a *repository
 * method*, where the tenant and the key are both known at the point the
 * subquery is written; a view has neither, which is what makes it the wrong
 * shape here rather than a wrong pattern there.
 *
 * `FINAL` costs exactly what no deduplication costs, prunes the full 8×, and is
 * correct across partitions — a version whose business time moved into a
 * different week still resolves to the newer row, because
 * `do_not_merge_across_partitions_select_final` is 0 by default. The repository
 * guidance against `FINAL` is about point lookups dragging heavy columns
 * through a merge; these views scan partitions, where the merge is the cheap
 * half and the unbounded subquery is the expensive one.
 *
 * Re-measured on every run by the pruning case in
 * `__tests__/governedViews.integration.test.ts`.
 */
export const SHIPPED_GOVERNED_DEDUP: GovernedDedupStrategy = "final";

/** Identifier shape ClickHouse accepts unquoted. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Column-name shape, which unlike a table name may carry dots.
 *
 * ClickHouse's nested columns are stored under dotted names
 * (`Messages.Content`), so a column identifier is validated more loosely than a
 * database or table one and is always backtick-quoted where it is emitted.
 */
const SAFE_COLUMN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function assertIdentifier(value: string, role: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `governed-sql views: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`,
    );
  }
  return value;
}

function assertColumn(value: string): string {
  if (!SAFE_COLUMN.test(value)) {
    throw new Error(
      `governed-sql views: column must match ${String(SAFE_COLUMN)}, got "${value}"`,
    );
  }
  return value;
}

/** A column name as SQL: backtick-quoted, because it may carry dots. */
function quotedColumn(value: string): string {
  return `\`${assertColumn(value)}\``;
}

/**
 * Alias every view body gives its source table.
 *
 * Load-bearing, not cosmetic. A view that exposes `SpanAttributes` (filtered)
 * and also reads a key out of `SpanAttributes` (unfiltered) resolves the second
 * bare reference to the *projection alias* — so the content-gated column came
 * back empty for every row while the view looked correct. Qualifying every
 * source reference with this alias is what keeps the two apart.
 */
const SOURCE_ALIAS = "src";

/** One of the source table's columns, qualified so no projection alias wins. */
function sourceColumn(name: string): string {
  return `${SOURCE_ALIAS}.${quotedColumn(name)}`;
}

/** The physical table a view reads. */
function sourceRelation({
  sourceDatabase,
  view,
}: {
  sourceDatabase: string;
  view: GovernedViewDefinition;
}): string {
  return `${assertIdentifier(sourceDatabase, "sourceDatabase")}.${assertIdentifier(view.sourceTable, "sourceTable")}`;
}

/**
 * The `WHERE` clause that keeps one version per logical row, or `null` when the
 * strategy needs none.
 *
 * Only the key columns appear in the inner scope. Adding the caller's time
 * range there would be the cheaper query and the wrong answer: if the newest
 * version of a row moved out of the range, the subquery reports an older
 * version's stamp and the outer scope matches that older row, so the view
 * returns stale data with no error and no gap.
 */
function dedupPredicate(
  view: GovernedViewDefinition,
  relation: string,
): string {
  const outerKeys = view.dedup.keyColumns.map(sourceColumn);
  const innerKeys = view.dedup.keyColumns.map(quotedColumn);
  const version = quotedColumn(view.dedup.versionColumn);
  return (
    `WHERE (${[...outerKeys, sourceColumn(view.dedup.versionColumn)].join(", ")}) IN (\n` +
    `    SELECT ${innerKeys.join(", ")}, max(${version})\n` +
    `    FROM ${relation}\n` +
    `    GROUP BY ${innerKeys.join(", ")}\n` +
    `  )`
  );
}

/**
 * `CREATE OR REPLACE VIEW` for one catalog entry.
 *
 * `OR REPLACE` rather than `IF NOT EXISTS`: re-provisioning a server whose
 * catalog has changed must converge on the current definition, and a view that
 * silently kept an older column list would expose a column the catalog no
 * longer claims.
 */
export function governedViewStatement({
  names,
  sourceDatabase,
  view,
  dedup,
}: {
  names: GovernedSqlNames;
  sourceDatabase: string;
  view: GovernedViewDefinition;
  dedup: GovernedDedupStrategy;
}): string {
  const relation = sourceRelation({ sourceDatabase, view });
  const projection = view.columns
    .map(
      (column) =>
        `  ${columnExpression(column, sourceColumn)} AS ${quotedColumn(column.name)}`,
    )
    .join(",\n");
  const aliased = `${relation} AS ${SOURCE_ALIAS}`;
  const from = dedup === "final" ? `${aliased} FINAL` : aliased;
  const where =
    dedup === "in-tuple" ? `\n${dedupPredicate(view, relation)}` : "";
  return (
    `CREATE OR REPLACE VIEW ` +
    `${assertIdentifier(names.database, "database")}.${assertIdentifier(view.name, "view")}\n` +
    `SQL SECURITY INVOKER\n` +
    `AS SELECT\n${projection}\n` +
    `FROM ${from}${where}`
  );
}

/**
 * Column-scoped `SELECT` on a view's source table.
 *
 * The catalog's source columns and nothing else, so an off-catalog column is
 * refused by the database with ACCESS_DENIED rather than by the gateway. That
 * distinction is the point: it holds for a caller who reached the database by
 * some path the gateway does not sit on.
 */
export function governedSourceColumnGrantStatement({
  names,
  sourceDatabase,
  view,
}: {
  names: GovernedSqlNames;
  sourceDatabase: string;
  view: GovernedViewDefinition;
}): string {
  const columns = governedViewSourceColumns(view).map(quotedColumn).join(", ");
  return (
    `GRANT SELECT(${columns}) ON ${sourceRelation({ sourceDatabase, view })} ` +
    `TO ${assertIdentifier(names.restrictedUser, "restrictedUser")}`
  );
}

/**
 * The source tables the catalog reads, each with its tenant column, ready for
 * a row policy.
 *
 * Deduplicated by table: two views over one table share its policy, and
 * creating the same policy twice is not idempotent in a way worth relying on.
 */
export function governedSourceTables({
  sourceDatabase,
  views = GOVERNED_VIEW_CATALOG,
}: {
  sourceDatabase: string;
  views?: readonly GovernedViewDefinition[];
}): GovernedTable[] {
  const byTable = new Map<string, GovernedTable>();
  for (const view of views) {
    byTable.set(view.sourceTable, {
      table: view.sourceTable,
      // Every fact table names the owning project the same way. The catalog
      // would have to grow a per-view tenant column if that ever stopped being
      // true; today asserting it here is what would catch the change.
      tenantColumn: "TenantId",
      database: sourceDatabase,
    });
  }
  return [...byTable.values()];
}

/**
 * Every statement that provisions the governed views, in dependency order.
 *
 * Runs *after* `governedClickHouseSetupStatements`, which mints the restricted
 * user: a grant created before the user still points at the replaced access
 * entity, so the ordering between the two is load-bearing in exactly the way
 * the setup list documents.
 *
 * The source tables themselves are not created here — they come from the
 * ClickHouse migrations. This function only exposes them.
 */
export function governedViewSetupStatements({
  names,
  sourceDatabase,
  views = GOVERNED_VIEW_CATALOG,
  dedup,
}: {
  names: GovernedSqlNames;
  sourceDatabase: string;
  views?: readonly GovernedViewDefinition[];
  dedup: GovernedDedupStrategy;
}): string[] {
  return [
    ...views.map((view) =>
      governedViewStatement({ names, sourceDatabase, view, dedup }),
    ),
    ...views.map((view) =>
      governedSourceColumnGrantStatement({ names, sourceDatabase, view }),
    ),
    ...views.map((view) => governedGrantStatement({ names, table: view.name })),
    ...governedSourceTables({ sourceDatabase, views }).map((governedTable) =>
      governedRowPolicyStatement({ names, governedTable }),
    ),
  ];
}
