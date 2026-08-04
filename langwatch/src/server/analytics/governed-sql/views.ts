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
  governedPostgresViews,
  governedViewSourceColumns,
  isPostgresResident,
} from "./catalog/types";
import {
  DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
  KEY_MAP_COLUMNS,
  type GovernedSqlNames,
  type GovernedTable,
  governedGrantStatement,
  governedRowPolicyStatement,
  postgresApprovedViewStatement,
  postgresEngineTableStatement,
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

/**
 * Alias the tenant-predicate subquery gives the key map.
 *
 * Needed because the key map and every mapped source name their tenant column
 * identically; see {@link postgresTenantPredicate}.
 */
const KEY_MAP_ALIAS = "km";

/** One of the source table's columns, qualified so no projection alias wins. */
function sourceColumn(name: string): string {
  return `${SOURCE_ALIAS}.${quotedColumn(name)}`;
}

/**
 * The column a dataset's source table names the owning project with.
 *
 * One name across both residences, and that is a design decision rather than a
 * coincidence: the fact tables call it this, and the approved PostgreSQL views
 * rename the application's `projectId` to match. Asserting it in one place is
 * what would catch either side drifting.
 */
const TENANT_COLUMN = "TenantId";

/**
 * The columns the restricted identity is granted on a dataset's source table.
 *
 * The two residences answer this differently because their source tables are
 * different objects. A fact table is the application's, carrying far more than
 * the catalog exposes, so the grant is the catalog's *source* columns. A
 * PostgreSQL-engine table was created from the catalog and carries exactly the
 * exposed columns already, so the grant is those — the narrowing that matters
 * happened one layer down, in the approved view.
 */
export function governedGrantedSourceColumns(
  view: GovernedViewDefinition,
): readonly string[] {
  if (isPostgresResident(view)) {
    return view.columns.map((column) => column.name);
  }
  return governedViewSourceColumns(view);
}

/**
 * The physical table a view reads.
 *
 * A PostgreSQL-resident dataset's source is the engine table in the *governed*
 * database rather than a fact table in the application's, so the database is
 * chosen from the entry rather than always taken from the argument.
 */
function sourceRelation({
  names,
  sourceDatabase,
  view,
}: {
  names: GovernedSqlNames;
  sourceDatabase: string;
  view: GovernedViewDefinition;
}): string {
  const database = isPostgresResident(view) ? names.database : sourceDatabase;
  return `${assertIdentifier(database, "sourceDatabase")}.${assertIdentifier(view.sourceTable, "sourceTable")}`;
}

/**
 * The predicate a PostgreSQL-resident view carries so the read that reaches the
 * primary is the caller's tenant and not the whole table.
 *
 * ## Why this exists at all
 *
 * The row policy on the engine table is what makes the mapping *safe*, and it
 * is not what makes it *cheap*: measured against 25.10.2.65, a row policy's
 * predicate is never pushed down to PostgreSQL — not in the key-map form, and
 * not even as a constant `TenantId = 'x'`. Every shape emits
 * `COPY (SELECT … FROM "approved_view") TO STDOUT` and filters inside
 * ClickHouse afterwards, so without this predicate any authenticated caller
 * could make the primary OLTP database read every tenant's rows. Measured
 * against the objects these generators provision, over a 10,016-row annotation
 * table where the asking tenant owns two, from PostgreSQL's own
 * `pg_stat_user_tables` accounting:
 *
 * | read                            | rows PostgreSQL read | statement it received |
 * | ------------------------------- | -------------------- | --------------------- |
 * | engine table, policy only       | 10,016               | no `WHERE` |
 * | governed view, valid key        | 2                    | `WHERE "TenantId" = 'tenant-a'` |
 * | governed view, unknown key      | 0                    | `WHERE "TenantId" = NULL` |
 *
 * The unknown-key row is the one worth noticing: the shape that returns nothing
 * used to cost a full scan of the primary, and now costs nothing.
 *
 * ## Why a scalar subquery, and why over the key map
 *
 * A scalar subquery is the one shape that pushes down: ClickHouse folds it to a
 * constant before it plans the PostgreSQL read, then sends that constant. The
 * `IN (subquery)` form the row policy uses stays a set and is applied after the
 * read, which is exactly why the policy does not contain load.
 *
 * It reads the key map with no `WHERE` of its own because the key map polices
 * *itself* — the restricted identity sees exactly the row its own hash matches
 * (`governedKeyMapRowPolicyStatement`). So the subquery yields this caller's
 * tenant and nothing else, and an unknown or empty key yields no row at all,
 * which ClickHouse folds to `NULL` and PostgreSQL matches nothing against. The
 * dependency is load-bearing: without the key map's self-policy this subquery
 * would see every row and fail as a multi-row scalar, which is a broken query
 * rather than a leak — but it is why `governedPolicyCoverageQuery` auditing
 * that policy matters here too.
 *
 * ## Why this is a performance control and not a security boundary
 *
 * The row policy still applies underneath it, so a wrong predicate costs a
 * wrong read and never a wrong answer. Proven directly rather than argued: with
 * the predicate hard-coded to a foreign tenant, PostgreSQL really does read and
 * ship that tenant's rows, and the caller receives zero — see
 * `__tests__/postgresEngineIsolation.integration.test.ts`.
 */
function postgresTenantPredicate({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  // The key map is aliased and the inner reference qualified because the two
  // relations name their tenant column the same way: written bare, the
  // identifier could bind to the outer scope and turn this into a correlated
  // subquery, which ClickHouse does not support and would fail rather than
  // silently widen — but failing at provisioning time is not a risk worth
  // taking for two characters.
  const keyMap = `${assertIdentifier(names.database, "database")}.${assertIdentifier(names.keyMapTable, "keyMapTable")}`;
  return (
    `WHERE ${sourceColumn(TENANT_COLUMN)} = (\n` +
    `    SELECT ${KEY_MAP_ALIAS}.${quotedColumn(KEY_MAP_COLUMNS.tenantId)}\n` +
    `    FROM ${keyMap} AS ${KEY_MAP_ALIAS}\n` +
    `  )`
  );
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
  const { versionColumn } = view.dedup;
  if (!versionColumn) {
    // Refuse at provisioning time rather than emit a view that collapses
    // nothing: this strategy exists to keep one version per key, and a source
    // with no version column has no survivor to pick. Reachable only if a
    // dataset is given this strategy without declaring the column — the
    // PostgreSQL-resident ones take the tenant-predicate branch instead.
    throw new Error(
      `governed view ${view.name} deduplicates on a version column it does not declare`,
    );
  }
  const outerKeys = view.dedup.keyColumns.map(sourceColumn);
  const innerKeys = view.dedup.keyColumns.map(quotedColumn);
  const version = quotedColumn(versionColumn);
  return (
    `WHERE (${[...outerKeys, sourceColumn(versionColumn)].join(", ")}) IN (\n` +
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
  const relation = sourceRelation({ names, sourceDatabase, view });
  // A PostgreSQL-resident source keeps one row per key, so there is no version
  // to collapse and neither dedup shape applies; what it needs instead is the
  // predicate that keeps the read off the primary from being a whole-table one.
  const postgres = isPostgresResident(view);
  const projection = view.columns
    .map((column) => {
      // The engine table already carries the catalog's names and types — the
      // approved PostgreSQL view did the renaming, one layer further down — so
      // here the projection is an identity. Reading `sourceColumns` instead
      // would name the *application's* columns, which the engine table does not
      // have.
      const expression = postgres
        ? sourceColumn(column.name)
        : columnExpression(column, sourceColumn);
      return `  ${expression} AS ${quotedColumn(column.name)}`;
    })
    .join(",\n");
  const aliased = `${relation} AS ${SOURCE_ALIAS}`;
  const from = dedup === "final" && !postgres ? `${aliased} FINAL` : aliased;
  const where = postgres
    ? `\n${postgresTenantPredicate({ names })}`
    : dedup === "in-tuple"
      ? `\n${dedupPredicate(view, relation)}`
      : "";
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
  const columns = governedGrantedSourceColumns(view).map(quotedColumn).join(", ");
  return (
    `GRANT SELECT(${columns}) ON ${sourceRelation({ names, sourceDatabase, view })} ` +
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
  names,
  sourceDatabase,
  views = GOVERNED_VIEW_CATALOG,
}: {
  names: GovernedSqlNames;
  sourceDatabase: string;
  views?: readonly GovernedViewDefinition[];
}): GovernedTable[] {
  const byTable = new Map<string, GovernedTable>();
  for (const view of views) {
    byTable.set(view.sourceTable, {
      table: view.sourceTable,
      // Every source names the owning project the same way — the fact tables
      // because that is their column, the PostgreSQL-engine tables because the
      // approved view renamed the application's `projectId` to match. The
      // catalog would have to grow a per-view tenant column if that ever
      // stopped being true; today asserting it here is what would catch it.
      tenantColumn: TENANT_COLUMN,
      // A PostgreSQL-engine table lives in the governed database, beside the
      // view over it, rather than in the application's.
      database: isPostgresResident(view) ? names.database : sourceDatabase,
    });
  }
  return [...byTable.values()];
}

/**
 * The approved PostgreSQL views the catalog's PostgreSQL-resident datasets
 * read, as statements to run *against PostgreSQL*.
 *
 * The only statements this module produces that are not ClickHouse SQL, and
 * they are here rather than in a Prisma migration on purpose. These views are
 * not part of the application's schema: their column lists are the governed
 * catalog's, they change when the catalog changes, and nothing the application
 * itself does reads them. Binding them to the migration history would tie a
 * catalog edit to a schema migration and leave the two able to disagree.
 *
 * Run before {@link postgresReaderRoleStatements}, whose grants name them.
 */
export function governedPostgresApprovedViewStatements({
  schema,
  views = GOVERNED_VIEW_CATALOG,
}: {
  /** PostgreSQL schema the application's tables live in. */
  schema: string;
  views?: readonly GovernedViewDefinition[];
}): string[] {
  return governedPostgresViews(views).map((view) =>
    postgresApprovedViewStatement({
      schema,
      view: view.postgres.approvedView,
      baseRelation: view.postgres.baseRelation,
      columns: view.columns.map((column) => ({
        exposed: column.name,
        // The tenant column is the one rename every mapping performs; the rest
        // are the base relation's own names, taken from the catalog.
        source:
          column.name === TENANT_COLUMN
            ? view.postgres.tenantSourceColumn
            : singleSourceColumn(view, column.name),
      })),
    }),
  );
}

/** The approved views the reader role must be granted, in catalog order. */
export function governedApprovedPostgresViewNames(
  views: readonly GovernedViewDefinition[] = GOVERNED_VIEW_CATALOG,
): string[] {
  return governedPostgresViews(views).map((view) => view.postgres.approvedView);
}

/**
 * Connections to allow the reader role, derived from the catalog rather than
 * chosen.
 *
 * The two numbers have to agree or the tighter one fails first, and they are
 * set in different files — which is exactly how a `CONNECTION LIMIT` sized for
 * one mapped table survived until a catalog of six exhausted it with idle
 * pooled connections and then refused the role's next login. Deriving it is
 * what stops that recurring when a dataset is added.
 *
 * Headroom on top of the pools' total demand, for the connection a
 * re-provisioning run or an operator's `psql` needs while the pools are full.
 */
export function governedPostgresReaderConnectionLimit({
  views = GOVERNED_VIEW_CATALOG,
  connectionPoolSize = DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
  concurrentCatalogs = 1,
  headroom = 3,
}: {
  views?: readonly GovernedViewDefinition[];
  connectionPoolSize?: number;
  /**
   * ClickHouse deployments mapping this PostgreSQL role at once.
   *
   * One in production — a governed database per deployment. More wherever
   * several governed databases share a server and a role, which is the shape
   * the test harness has and the reason this is a parameter: the cap is a
   * property of how many pools point at the role, not of how many the catalog
   * describes.
   */
  concurrentCatalogs?: number;
  headroom?: number;
} = {}): number {
  return (
    governedPostgresViews(views).length * connectionPoolSize * concurrentCatalogs +
    headroom
  );
}

/**
 * The PostgreSQL-engine tables mapping each approved view into the governed
 * database, as ClickHouse statements.
 *
 * Run before {@link governedViewSetupStatements}, which builds the governed
 * views over them, and after the named collection exists.
 */
export function governedPostgresEngineTableStatements({
  names,
  collection,
  views = GOVERNED_VIEW_CATALOG,
}: {
  names: GovernedSqlNames;
  /** Named collection holding the PostgreSQL credentials. */
  collection: string;
  views?: readonly GovernedViewDefinition[];
}): string[] {
  return governedPostgresViews(views).map((view) =>
    postgresEngineTableStatement({
      names,
      table: view.sourceTable,
      columns: view.columns.map((column) => ({
        name: column.name,
        type: column.type,
      })),
      collection,
      postgresRelation: view.postgres.approvedView,
    }),
  );
}

/**
 * The one column a mapped dataset's exposed column reads.
 *
 * A PostgreSQL-resident column is a projection of exactly one base column: the
 * approved view is a rename, never a computation, so that what the reader role
 * is granted and what the catalog exposes are the same list rather than two
 * lists that have to agree.
 */
function singleSourceColumn(
  view: GovernedViewDefinition,
  columnName: string,
): string {
  const column = view.columns.find((candidate) => candidate.name === columnName);
  const [only] = column?.sourceColumns ?? [];
  if (!only || column?.sourceColumns.length !== 1) {
    throw new Error(
      `governed-sql views: PostgreSQL-resident column "${view.name}.${columnName}" must read ` +
        `exactly one source column; the approved view renames, it does not compute`,
    );
  }
  return only;
}

/**
 * Every statement that provisions the governed views, in dependency order.
 *
 * Runs *after* `governedClickHouseSetupStatements`, which mints the restricted
 * user: a grant created before the user still points at the replaced access
 * entity, so the ordering between the two is load-bearing in exactly the way
 * the setup list documents.
 *
 * The source tables themselves are not created here — the ClickHouse ones come
 * from migrations, and the PostgreSQL-engine ones from
 * {@link governedPostgresEngineTableStatements}, which must have run first.
 * This function only exposes them.
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
    // A fact table carries far more than the catalog exposes, so its grant is
    // column-scoped. A PostgreSQL-engine table was *created from* the catalog
    // and its whole column list is the exposed surface, so it takes the
    // whole-object grant the key map and the views take — which is also what
    // keeps `SHOW CREATE TABLE` answerable, the surface the credential-leak
    // assertion inspects.
    ...views.map((view) =>
      isPostgresResident(view)
        ? governedGrantStatement({ names, table: view.sourceTable })
        : governedSourceColumnGrantStatement({ names, sourceDatabase, view }),
    ),
    ...views.map((view) => governedGrantStatement({ names, table: view.name })),
    ...governedSourceTables({ names, sourceDatabase, views }).map(
      (governedTable) => governedRowPolicyStatement({ names, governedTable }),
    ),
  ];
}
