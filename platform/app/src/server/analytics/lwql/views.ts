/**
 * LangWatchQL analytics SQL — the `analytics.*` views, as SQL text.
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
 * @see ./catalog/lwqlViews.ts — the catalog these statements are built from
 * @see ./provisioning.ts — the access model applied over them
 * @see specs/analytics/lwql-api.feature
 */

import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import {
  columnExpression,
  isPostgresResident,
  type LangWatchQLDedupStrategy,
  type LangWatchQLViewColumn,
  type LangWatchQLViewDefinition,
  lwqlGrainColumns,
  lwqlPostgresViews,
  lwqlViewSourceColumns,
} from "./catalog/types";
import {
  DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
  postgresApprovedViewStatement,
  postgresEngineTableStatement,
} from "./postgresMapping";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  type LangWatchQLTable,
  lwqlGrantStatement,
  lwqlRowPolicyStatement,
} from "./provisioning";

/**
 * The strategy the shipped views use where a catalog entry pins none of its
 * own (`LangWatchQLViewDedup.strategy`, in `./catalog/types.ts`).
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
 * `FINAL` costs exactly what no deduplication costs, prunes the full 8×, and
 * follows a row across partitions — a version whose business time moved into a
 * different week still resolves to the newer row, because
 * `do_not_merge_across_partitions_select_final` is 0 by default. The repository
 * guidance against `FINAL` is about point lookups dragging heavy columns
 * through a merge; these views scan partitions, where the merge is the cheap
 * half and the unbounded subquery is the expensive one.
 *
 * What it cannot do is collapse two versions that carry two *sort keys*. It
 * merges on the table's `ORDER BY`, so a source whose sort key holds a column
 * the write path moves keeps both versions and doubles every aggregate over
 * them, silently. That is a property of the source rather than of the strategy,
 * which is why it is answered per entry (`LangWatchQLViewDedup.strategy`) rather
 * than by moving the default: the tables whose sort keys hold still —
 * every one but `evaluation_analytics` today — would pay the unbounded subquery
 * above for a correctness problem they do not have.
 *
 * Re-measured on every run by the pruning case in
 * `__tests__/lwqlViews.integration.test.ts`.
 */
export const SHIPPED_LWQL_DEDUP: LangWatchQLDedupStrategy = "final";

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
      `lwql views: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`,
    );
  }
  return value;
}

function assertColumn(value: string): string {
  if (!SAFE_COLUMN.test(value)) {
    throw new Error(
      `lwql views: column must match ${String(SAFE_COLUMN)}, got "${value}"`,
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
export function lwqlGrantedSourceColumns(
  view: LangWatchQLViewDefinition,
): readonly string[] {
  if (isPostgresResident(view)) {
    return view.columns.map((column) => column.name);
  }
  return lwqlViewSourceColumns(view);
}

/**
 * The physical table a view reads.
 *
 * A PostgreSQL-resident dataset's source is the engine table in the *LangWatchQL*
 * database rather than a fact table in the application's, so the database is
 * chosen from the entry rather than always taken from the argument.
 */
function sourceRelation({
  names,
  sourceDatabase,
  view,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  view: LangWatchQLViewDefinition;
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
 * | LangWatchQL view, valid key        | 2                    | `WHERE "TenantId" = 'tenant-a'` |
 * | LangWatchQL view, unknown key      | 0                    | `WHERE "TenantId" = NULL` |
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
 * (`lwqlKeyMapRowPolicyStatement`). So the subquery yields this caller's
 * tenant and nothing else, and an unknown or empty key yields no row at all,
 * which ClickHouse folds to `NULL` and PostgreSQL matches nothing against. The
 * dependency is load-bearing: without the key map's self-policy this subquery
 * would see every row and fail as a multi-row scalar, which is a broken query
 * rather than a leak — but it is why `lwqlPolicyCoverageQuery` auditing
 * that policy matters here too.
 *
 * ## Why the `LIMIT 1`
 *
 * The self-policy narrows the subquery to one *hash*, not to one *row*. The key
 * map is `ENGINE = MergeTree ORDER BY KeyHash`, which enforces no uniqueness,
 * so a retried provisioning step or a re-issued key leaves two rows the policy
 * both admits and the scalar subquery fails the whole query with
 * `INCORRECT_RESULT_OF_SCALAR_SUBQUERY`. That failure is invisible from the
 * query text and takes out every PostgreSQL-resident dataset for the affected
 * key at once. Bounding it is safe because duplicates are copies: a hash maps
 * to one API key, which belongs to one project, so every admitted row carries
 * the same `TenantId` and which one is taken cannot change the answer. `LIMIT
 * 1` is the bound that keeps the shape scalar — an `IN (subquery)` would stop
 * pushing down and hand the primary the full scan this predicate exists to
 * prevent.
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
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  /**
   * Database the key-map table actually lives in. Defaults to
   * {@link LangWatchQLNames.database} — see `provisioning.ts`'s
   * `lwqlClickHouseSetupStatements` for why this must agree with every other
   * key-map reference: a real deploy's key map lives in the app's own
   * ClickHouse database (migration 00084), not `names.database`.
   */
  sourceDatabase?: string;
}): string {
  // The key map is aliased and the inner reference qualified because the two
  // relations name their tenant column the same way: written bare, the
  // identifier could bind to the outer scope and turn this into a correlated
  // subquery, which ClickHouse does not support and would fail rather than
  // silently widen — but failing at provisioning time is not a risk worth
  // taking for two characters.
  const keyMapDatabase = sourceDatabase ?? names.database;
  const keyMap = `${assertIdentifier(keyMapDatabase, "database")}.${assertIdentifier(names.keyMapTable, "keyMapTable")}`;
  return (
    `WHERE ${sourceColumn(TENANT_COLUMN)} = (\n` +
    `    SELECT ${KEY_MAP_ALIAS}.${quotedColumn(KEY_MAP_COLUMNS.tenantId)}\n` +
    `    FROM ${keyMap} AS ${KEY_MAP_ALIAS}\n` +
    `    LIMIT 1\n` +
    `  )`
  );
}

/**
 * The strategy one view is rendered with: its own where it pins one, and the
 * caller's default otherwise.
 *
 * The entry wins because the reason an entry pins a strategy is a property of
 * its source table that no default can be right about — see
 * {@link SHIPPED_LWQL_DEDUP}. The default still reaches every other view,
 * which is what keeps the measurement case able to render the whole catalog
 * three ways.
 */
function dedupStrategyFor({
  view,
  dedup,
}: {
  view: LangWatchQLViewDefinition;
  dedup: LangWatchQLDedupStrategy;
}): LangWatchQLDedupStrategy {
  return view.dedup.strategy ?? dedup;
}

/**
 * The `WHERE` clause that keeps one version per logical row.
 *
 * Groups by the dataset's grain rather than by the source's sort key, which is
 * the whole reason an entry reaches for this strategy: where the two differ,
 * the sort key holds a column the write path moves, and grouping by it would
 * report a `max()` per *version* and match every one of them.
 *
 * Only those columns appear in the inner scope. Adding the caller's time range
 * there would be the cheaper query and the wrong answer: if the newest version
 * of a row moved out of the range, the subquery reports an older version's
 * stamp and the outer scope matches that older row, so the view returns stale
 * data with no error and no gap.
 *
 * One residual, and it is the reason the repositories rank their candidates
 * (`evaluation-analytics.clickhouse.repository.ts`): two writers resuming from
 * the same committed version can stamp the same `UpdatedAt`, and both rows then
 * satisfy the `IN`. A view has no per-key `LIMIT 1` to break that tie, so such a
 * pair is returned as two rows — rare, visible as a duplicate, and a far smaller
 * error than `FINAL`'s silent double-count of every multi-version row.
 */
function dedupPredicate(
  view: LangWatchQLViewDefinition,
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
      view.dedup.aggregating
        ? `LangWatchQL view ${view.name} reads an aggregating source, whose rows for one key are summed ` +
            `rather than superseded, so there is no version for this strategy to pick`
        : `LangWatchQL view ${view.name} deduplicates on a version column it does not declare`,
    );
  }
  const grain = lwqlGrainColumns(view);
  const outerKeys = grain.map(sourceColumn);
  const innerKeys = grain.map(quotedColumn);
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
 * One projection expression under the `GROUP BY` render mode.
 *
 * A grain column passes through untouched — it is what the view groups on — and
 * every other column must be a summed measure, whose expression sums inside the
 * derived cast. Anything else is refused at provisioning time: a plain column
 * under a `GROUP BY` would need an arbitrary-value aggregate, and an arbitrary
 * value that looks like a real one is exactly the class of wrong number this
 * catalog exists to prevent.
 */
function groupedColumnExpression(
  view: LangWatchQLViewDefinition,
  column: LangWatchQLViewColumn,
): string {
  const grain = lwqlGrainColumns(view);
  if (grain.includes(column.name)) {
    return columnExpression({ column, source: sourceColumn });
  }
  if (!column.summed) {
    throw new Error(
      `LangWatchQL view ${view.name} groups by its grain, and column "${column.name}" is neither part of ` +
        `the grain nor a summed measure, so it would take an arbitrary value from its group`,
    );
  }
  return columnExpression({ column, source: sourceColumn, isAggregated: true });
}

/**
 * `CREATE OR REPLACE VIEW` for one catalog entry.
 *
 * `OR REPLACE` rather than `IF NOT EXISTS`: re-provisioning a server whose
 * catalog has changed must converge on the current definition, and a view that
 * silently kept an older column list would expose a column the catalog no
 * longer claims.
 *
 * `dedup` is the default strategy; an entry pinning its own wins over it — see
 * {@link dedupStrategyFor}.
 */
export function lwqlViewStatement({
  names,
  sourceDatabase,
  view,
  dedup,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  view: LangWatchQLViewDefinition;
  dedup: LangWatchQLDedupStrategy;
}): string {
  const relation = sourceRelation({ names, sourceDatabase, view });
  // A PostgreSQL-resident source keeps one row per key, so there is no version
  // to collapse and neither dedup shape applies; what it needs instead is the
  // predicate that keeps the read off the primary from being a whole-table one.
  const postgres = isPostgresResident(view);
  const strategy = dedupStrategyFor({ view, dedup });
  const grain = lwqlGrainColumns(view);
  // An aggregating source whose published grain is narrower than the engine's
  // key cannot be served by `FINAL`: the merge collapses to the key, and the
  // surplus key columns would surface as extra rows per logical row. The view
  // aggregates instead — `GROUP BY` the grain with every measure summed —
  // which subsumes the merge, so `FINAL` is dropped rather than paid twice.
  const grouped =
    !postgres &&
    view.dedup.aggregating === true &&
    view.dedup.keyColumns.some((key) => !grain.includes(key));
  const projection = view.columns
    .map((column) => {
      // The engine table already carries the catalog's names and types — the
      // approved PostgreSQL view did the renaming, one layer further down — so
      // here the projection is an identity. Reading `sourceColumns` instead
      // would name the *application's* columns, which the engine table does not
      // have.
      const expression = postgres
        ? sourceColumn(column.name)
        : grouped
          ? groupedColumnExpression(view, column)
          : columnExpression({ column, source: sourceColumn });
      return `  ${expression} AS ${quotedColumn(column.name)}`;
    })
    .join(",\n");
  const aliased = `${relation} AS ${SOURCE_ALIAS}`;
  const from =
    strategy === "final" && !postgres && !grouped
      ? `${aliased} FINAL`
      : aliased;
  const where = postgres
    ? `\n${postgresTenantPredicate({ names, sourceDatabase })}`
    : strategy === "in-tuple"
      ? `\n${dedupPredicate(view, relation)}`
      : "";
  const groupBy = grouped
    ? `\nGROUP BY ${grain.map(sourceColumn).join(", ")}`
    : "";
  return (
    `CREATE OR REPLACE VIEW ` +
    `${assertIdentifier(names.database, "database")}.${assertIdentifier(view.name, "view")}\n` +
    `SQL SECURITY INVOKER\n` +
    `AS SELECT\n${projection}\n` +
    `FROM ${from}${where}${groupBy}`
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
export function lwqlSourceColumnGrantStatement({
  names,
  sourceDatabase,
  view,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  view: LangWatchQLViewDefinition;
}): string {
  const columns = lwqlGrantedSourceColumns(view).map(quotedColumn).join(", ");
  return (
    `GRANT SELECT(${columns}) ON ${sourceRelation({ names, sourceDatabase, view })} ` +
    `TO ${assertIdentifier(names.restrictedUser, "restrictedUser")}`
  );
}

/**
 * The source tables the catalog reads, each with its tenant column, ready for
 * a row policy.
 *
 * Deduplicated by qualified name: two views over one table in one database
 * share its policy, and creating the same policy twice is not idempotent in a
 * way worth relying on. Two tables that share a name across databases are
 * distinct sources and each keeps its own policy.
 */
export function lwqlSourceTables({
  names,
  sourceDatabase,
  views = LWQL_VIEW_CATALOG,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  views?: readonly LangWatchQLViewDefinition[];
}): LangWatchQLTable[] {
  const byTable = new Map<string, LangWatchQLTable>();
  for (const view of views) {
    // A PostgreSQL-engine table lives in the LangWatchQL database, beside the
    // view over it, rather than in the application's.
    const database = isPostgresResident(view) ? names.database : sourceDatabase;
    // Keyed on the qualified name, not the bare table. Two catalog entries can
    // share a `sourceTable` while resolving to different databases — one
    // PostgreSQL-resident, one a fact table — and keying on the bare name
    // collapses them to a single entry. The one that loses gets no row policy,
    // and the row policy is the tenant boundary, so the physical table becomes
    // readable across tenants by the restricted identity.
    byTable.set(`${database}.${view.sourceTable}`, {
      table: view.sourceTable,
      // Every source names the owning project the same way — the fact tables
      // because that is their column, the PostgreSQL-engine tables because the
      // approved view renamed the application's `projectId` to match. The
      // catalog would have to grow a per-view tenant column if that ever
      // stopped being true; today asserting it here is what would catch it.
      tenantColumn: TENANT_COLUMN,
      database,
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
 * not part of the application's schema: their column lists are the LangWatchQL
 * catalog's, they change when the catalog changes, and nothing the application
 * itself does reads them. Binding them to the migration history would tie a
 * catalog edit to a schema migration and leave the two able to disagree.
 *
 * Run before {@link postgresReaderRoleStatements}, whose grants name them.
 */
export function lwqlPostgresApprovedViewStatements({
  schema,
  views = LWQL_VIEW_CATALOG,
}: {
  /** PostgreSQL schema the application's tables live in. */
  schema: string;
  views?: readonly LangWatchQLViewDefinition[];
}): string[] {
  return lwqlPostgresViews(views).map((view) =>
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

/**
 * The approved views the reader role must be granted, in catalog order.
 *
 * No production caller in this repo — input to the infra-owned access model
 * (langwatch-saas#1126); reference implementation, not dead code.
 */
export function lwqlApprovedPostgresViewNames(
  views: readonly LangWatchQLViewDefinition[] = LWQL_VIEW_CATALOG,
): string[] {
  return lwqlPostgresViews(views).map((view) => view.postgres.approvedView);
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
 *
 * No production caller in this repo — input to the infra-owned reader role
 * (langwatch-saas#1126); reference implementation, not dead code.
 */
export function lwqlPostgresReaderConnectionLimit({
  views = LWQL_VIEW_CATALOG,
  connectionPoolSize = DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
  concurrentCatalogs = 1,
  headroom = 3,
}: {
  views?: readonly LangWatchQLViewDefinition[];
  connectionPoolSize?: number;
  /**
   * ClickHouse deployments mapping this PostgreSQL role at once.
   *
   * One in production — a LangWatchQL database per deployment. More wherever
   * several LangWatchQL databases share a server and a role, which is the shape
   * the test harness has and the reason this is a parameter: the cap is a
   * property of how many pools point at the role, not of how many the catalog
   * describes.
   */
  concurrentCatalogs?: number;
  headroom?: number;
} = {}): number {
  return (
    lwqlPostgresViews(views).length * connectionPoolSize * concurrentCatalogs +
    headroom
  );
}

/**
 * The PostgreSQL-engine tables mapping each approved view into the LangWatchQL
 * database, as ClickHouse statements.
 *
 * Run before {@link lwqlViewSetupStatements}, which builds the LangWatchQL
 * views over them, and after the named collection exists.
 *
 * Not called from any production path in this repo: the real tables are owned
 * by infra (langwatch-saas#1126). This is the reference implementation that
 * terraform must match — keep it and its tests in sync, do not delete as dead
 * code.
 */
export function lwqlPostgresEngineTableStatements({
  names,
  collection,
  views = LWQL_VIEW_CATALOG,
}: {
  names: LangWatchQLNames;
  /** Named collection holding the PostgreSQL credentials. */
  collection: string;
  views?: readonly LangWatchQLViewDefinition[];
}): string[] {
  return lwqlPostgresViews(views).map((view) =>
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
  view: LangWatchQLViewDefinition,
  columnName: string,
): string {
  const column = view.columns.find(
    (candidate) => candidate.name === columnName,
  );
  const [only] = column?.sourceColumns ?? [];
  if (!only || column?.sourceColumns.length !== 1) {
    throw new Error(
      `lwql views: PostgreSQL-resident column "${view.name}.${columnName}" must read ` +
        `exactly one source column; the approved view renames, it does not compute`,
    );
  }
  return only;
}

/**
 * Every statement that provisions the LangWatchQL views, in dependency order.
 *
 * Runs *after* `lwqlClickHouseSetupStatements`, which mints the restricted
 * user: a grant created before the user still points at the replaced access
 * entity, so the ordering between the two is load-bearing in exactly the way
 * the setup list documents.
 *
 * The source tables themselves are not created here — the ClickHouse ones come
 * from migrations, and the PostgreSQL-engine ones from
 * {@link lwqlPostgresEngineTableStatements}, which must have run first.
 * This function only exposes them.
 *
 * Not called from any production path in this repo: the real views' grants and
 * access model are owned by infra (langwatch-saas#1126). This is the reference
 * implementation that terraform must match — keep it and its tests in sync, do
 * not delete as dead code.
 */
export function lwqlViewSetupStatements({
  names,
  sourceDatabase,
  views = LWQL_VIEW_CATALOG,
  dedup,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  views?: readonly LangWatchQLViewDefinition[];
  dedup: LangWatchQLDedupStrategy;
}): string[] {
  return [
    ...views.map((view) =>
      lwqlViewStatement({ names, sourceDatabase, view, dedup }),
    ),
    // A fact table carries far more than the catalog exposes, so its grant is
    // column-scoped. A PostgreSQL-engine table was *created from* the catalog
    // and its whole column list is the exposed surface, so it takes the
    // whole-object grant the key map and the views take — which is also what
    // keeps `SHOW CREATE TABLE` answerable, the surface the credential-leak
    // assertion inspects.
    ...views.map((view) =>
      isPostgresResident(view)
        ? lwqlGrantStatement({ names, table: view.sourceTable })
        : lwqlSourceColumnGrantStatement({ names, sourceDatabase, view }),
    ),
    ...views.map((view) => lwqlGrantStatement({ names, table: view.name })),
    ...lwqlSourceTables({ names, sourceDatabase, views }).map((lwqlTable) =>
      lwqlRowPolicyStatement({ names, lwqlTable }),
    ),
  ];
}
