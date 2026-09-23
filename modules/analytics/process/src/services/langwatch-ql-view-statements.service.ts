/**
 * @see ./catalog/lwql-views.ts — the catalog these statements are built from
 * @see ./provisioning.ts — the access model applied over them
 * @see specs/lwql/api.feature
 */
import { LWQL_SOURCE_ALIAS } from "../rules/lwql-source-alias.rules.ts";
import { TENANT_COLUMN } from "../rules/lwql-view-catalog.rules.ts";
import { KEY_MAP_COLUMNS, type LangWatchQLNames } from "./langwatch-ql-access-model.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLDedupStrategy,
  type LangWatchQLViewColumn,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const sqlText = LangWatchQLSqlTextService.create();

/**
 * The strategy the shipped views use where a catalog entry pins none of its own
 * (`LangWatchQLViewDedup.strategy`, in `./catalog/types.ts`). Set by measurement, not by
 * preference.
 */
export const SHIPPED_LWQL_DEDUP: LangWatchQLDedupStrategy = "final";

/**
 * Alias every view body gives its source table. Load-bearing, not cosmetic.
 */
const SOURCE_ALIAS = LWQL_SOURCE_ALIAS;

/**
 * Alias the tenant-predicate subquery gives the key map. Needed because the key map and every
 * mapped source name their tenant column identically; see {@link postgresTenantPredicate}.
 */
const KEY_MAP_ALIAS = "km";

/** One of the source table's columns, qualified so no projection alias wins. */
function sourceColumn(name: string): string {
  return `${SOURCE_ALIAS}.${sqlText.quotedColumn(name)}`;
}

/**
 * The column a dataset's source table names the owning project with. One name across both
 * residences, and that is a design decision rather than a coincidence: the fact tables call it
 * this, and the approved PostgreSQL views rename the application's `projectId` to match.
 */

/**
 * The physical table a view reads. A PostgreSQL-resident dataset's source is the engine table
 * in the *LangWatchQL* database rather than a fact table in the application's, so the database
 * is chosen from the entry rather than always taken from the argument.
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
  const database = catalogShapes.isPostgresResident(view) ? names.database : sourceDatabase;

  return `${sqlText.assertIdentifier(database, "sourceDatabase")}.${sqlText.assertIdentifier(view.sourceTable, "sourceTable")}`;
}

/**
 * The predicate a PostgreSQL-resident view carries so the read that reaches the primary is the
 * caller's tenant and not the whole table.
 */
function postgresTenantPredicate({ names }: { names: LangWatchQLNames }): string {
  // The key map is aliased and the inner reference qualified because the two relations name
  // their tenant column the same way: written bare, the identifier could bind to the outer
  // scope and turn this into a correlated subquery, which ClickHouse does not support and would
  // fail rather than silently widen — but failing at provisioning time is not a risk worth
  // taking for two characters.
  const keyMap = `${sqlText.assertIdentifier(names.database, "database")}.${sqlText.assertIdentifier(names.keyMapTable, "keyMapTable")}`;

  // The self-policy narrows the subquery to one *hash*, not to one *row*. The key map is
  // `ENGINE = MergeTree ORDER BY KeyHash`, which enforces no uniqueness, so a retried
  // provisioning step or a re-issued key leaves two rows the policy both admits and the scalar
  // subquery fails the whole query with `INCORRECT_RESULT_OF_SCALAR_SUBQUERY`.
  return (
    `WHERE ${sourceColumn(TENANT_COLUMN)} = (\n` +
    `    SELECT ${KEY_MAP_ALIAS}.${sqlText.quotedColumn(KEY_MAP_COLUMNS.tenantId)}\n` +
    `    FROM ${keyMap} AS ${KEY_MAP_ALIAS}\n` +
    `    LIMIT 1\n` +
    `  )`
  );
}

/**
 * The strategy one view is rendered with: its own where it pins one, and the caller's default
 * otherwise. The entry wins because the reason an entry pins a strategy is a property of its
 * source table that no default can be right about — see {@link SHIPPED_LWQL_DEDUP}.
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
 */
function dedupPredicate(view: LangWatchQLViewDefinition, relation: string): string {
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

  // Grain is exposed names; the subquery runs against the source table, so map
  // each to the physical column its view column reads (an alias renames it).
  const grain = catalogShapes
    .grainColumns(view)
    .map((column) => catalogShapes.physicalColumn(view, column));
  const outerKeys = grain.map(sourceColumn);
  const innerKeys = grain.map((column) => sqlText.quotedColumn(column));
  const version = sqlText.quotedColumn(versionColumn);

  return (
    `WHERE (${[...outerKeys, sourceColumn(versionColumn)].join(", ")}) IN (\n` +
    `    SELECT ${innerKeys.join(", ")}, max(${version})\n` +
    `    FROM ${relation}\n` +
    `    GROUP BY ${innerKeys.join(", ")}\n` +
    `  )`
  );
}

/**
 * One projection expression under the `GROUP BY` render mode. A grain column passes through
 * untouched — it is what the view groups on — and every other column must be a summed measure,
 * whose expression sums inside the derived cast.
 */
function groupedColumnExpression(
  view: LangWatchQLViewDefinition,
  column: LangWatchQLViewColumn,
): string {
  const grain = catalogShapes.grainColumns(view);
  if (grain.includes(column.name)) {
    return catalogShapes.columnExpression({ column, source: sourceColumn });
  }

  // An aggregate-function column carries its own combinator in its expression
  // (`sumMerge`, `argMaxMerge`, a plain `max` for a SimpleAggregateFunction) —
  // itself an aggregate, so it is well-defined under the group.
  if (column.aggregate) {
    return catalogShapes.columnExpression({
      column,
      source: sourceColumn,
      joined: joinedColumnQualifier(view),
    });
  }

  if (!column.summed) {
    throw new Error(
      `LangWatchQL view ${view.name} groups by its grain, and column "${column.name}" is neither part of ` +
        `the grain nor a summed measure, so it would take an arbitrary value from its group`,
    );
  }

  return catalogShapes.columnExpression({ column, source: sourceColumn, isAggregated: true });
}

/**
 * One projection expression: an identity over a PostgreSQL engine table (the
 * approved view already renamed), the grouped form under `GROUP BY`, else the
 * column's own expression.
 */
function projectedExpression({
  view,
  column,
  postgres,
  grouped,
  joinedColumn,
}: {
  view: LangWatchQLViewDefinition;
  column: LangWatchQLViewColumn;
  postgres: boolean;
  grouped: boolean;
  joinedColumn: ((name: string) => string) | undefined;
}): string {
  if (postgres) {
    return sourceColumn(column.name);
  }

  if (grouped) {
    return groupedColumnExpression(view, column);
  }

  return catalogShapes.columnExpression({ column, source: sourceColumn, joined: joinedColumn });
}

/**
 * Qualifies a joined-table column, passed to a column's expression as its
 * `joined` argument. `undefined` for a single-table view, so a column there
 * cannot reference a table the view does not read.
 */
function joinedColumnQualifier(
  view: LangWatchQLViewDefinition,
): ((name: string) => string) | undefined {
  const { join } = view;
  if (!join) {
    return undefined;
  }

  return (name: string) =>
    `${sqlText.assertIdentifier(join.alias, "join alias")}.${sqlText.quotedColumn(name)}`;
}

/**
 * The `<kind> JOIN <table> AS <alias> ON <predicate>` clause, or `""` for a
 * single-table view — which is what keeps every existing view's SQL identical.
 * The joined table lives in the same source database as the primary.
 */
function joinRelationClause(view: LangWatchQLViewDefinition, sourceDatabase: string): string {
  const { join } = view;
  if (!join) {
    return "";
  }

  const relation = `${sqlText.assertIdentifier(sourceDatabase, "sourceDatabase")}.${sqlText.assertIdentifier(join.table, "join table")}`;

  return (
    `\n${join.kind ?? "INNER"} JOIN ${relation} ` +
    `AS ${sqlText.assertIdentifier(join.alias, "join alias")} ON ${join.on}`
  );
}

/**
 * The pre-filter clause: ANDed onto whatever `where` the dedup or postgres shape
 * already emitted, and opening the clause itself when there is none.
 */
function preFilterClause(view: LangWatchQLViewDefinition, where: string): string {
  if (!view.where) {
    return "";
  }

  return where ? `\n  AND (${view.where})` : `\nWHERE ${view.where}`;
}

/**
 * Refuses a `where`/`on` predicate whose columns no grant covers. The columns
 * are declared rather than parsed out of the SQL, so a predicate set without its
 * column list would silently deny the restricted read at query time.
 */
function assertPredicateColumnsDeclared(view: LangWatchQLViewDefinition): void {
  if (view.where && !view.whereSourceColumns?.length) {
    throw new Error(
      `LangWatchQL view ${view.name} sets a where predicate but no whereSourceColumns; ` +
        `list the columns it reads so they are granted`,
    );
  }

  if (!view.join) {
    return;
  }

  const on = view.join.onSourceColumns;
  if ((on?.primary?.length ?? 0) + (on?.joined?.length ?? 0) === 0) {
    throw new Error(
      `LangWatchQL view ${view.name} declares a join but no join.onSourceColumns; ` +
        `list the columns its ON reads on each side so they are granted`,
    );
  }
}

/**
 * Column-scoped `SELECT` on a view's source table. The catalog's source columns and nothing
 * else, so an off-catalog column is refused by the database with ACCESS_DENIED rather than by
 * the gateway.
 */

/** The `analytics.*` views, as the ClickHouse statements that create them. */
export class LangWatchQLViewStatementsService {
  static create(): LangWatchQLViewStatementsService {
    return new LangWatchQLViewStatementsService();
  }

  private constructor() {}

  /**
   * The columns the restricted identity is granted on a dataset's source table. The two
   * residences answer this differently because their source tables are different objects.
   */
  grantedSourceColumns(view: LangWatchQLViewDefinition): readonly string[] {
    if (catalogShapes.isPostgresResident(view)) {
      return view.columns.map((column) => column.name);
    }

    return catalogShapes.viewSourceColumns(view);
  }

  /**
   * `CREATE OR REPLACE VIEW` for one catalog entry.
   */
  viewStatement({
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
    const postgres = catalogShapes.isPostgresResident(view);
    // A join reaches a second fact table in the same source database. Refused for
    // a PostgreSQL-resident dataset, whose only relation is its own engine table.
    if (view.join && postgres) {
      throw new Error(
        `LangWatchQL view ${view.name} declares a join and is PostgreSQL-resident; ` +
          `a join reads a second ClickHouse fact table and cannot apply here`,
      );
    }

    assertPredicateColumnsDeclared(view);
    const joinedColumn = joinedColumnQualifier(view);
    const strategy = dedupStrategyFor({ view, dedup });
    const grain = catalogShapes.grainColumns(view);
    // Any aggregating source renders as a `GROUP BY`, whether its published grain
    // is narrower than the engine key (a rollup that groups away a breakdown
    // column) or equal to it (a per-key rollup whose measures are aggregate
    // states only a merge combinator can read). `FINAL` is not an option for the
    // latter: after a merge the state column is still binary.
    const grouped = !postgres && view.dedup.aggregating === true;
    const projection = view.columns
      .map((column) => {
        const expression = projectedExpression({ view, column, postgres, grouped, joinedColumn });

        return `  ${expression} AS ${sqlText.quotedColumn(column.name)}`;
      })
      .join(",\n");
    const aliased = `${relation} AS ${SOURCE_ALIAS}`;
    const from = strategy === "final" && !postgres && !grouped ? `${aliased} FINAL` : aliased;
    const joinClause = joinRelationClause(view, sourceDatabase);
    const enginePredicate = strategy === "in-tuple" ? `\n${dedupPredicate(view, relation)}` : "";
    const where = postgres ? `\n${postgresTenantPredicate({ names })}` : enginePredicate;
    const preFilter = preFilterClause(view, where);
    const groupBy = grouped
      ? `\nGROUP BY ${grain.map((column) => sourceColumn(catalogShapes.physicalColumn(view, column))).join(", ")}`
      : "";

    return (
      `CREATE OR REPLACE VIEW ` +
      `${sqlText.assertIdentifier(names.database, "database")}.${sqlText.assertIdentifier(view.name, "view")}\n` +
      `SQL SECURITY INVOKER\n` +
      `AS SELECT\n${projection}\n` +
      `FROM ${from}${joinClause}${where}${preFilter}${groupBy}`
    );
  }

  /**
   * The column grant that bounds what the view may read. The catalog's source columns and
   * nothing else, so an off-catalog column is refused by the database with ACCESS_DENIED rather
   * than by the gateway.
   */
  sourceColumnGrantStatement({
    names,
    sourceDatabase,
    view,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    view: LangWatchQLViewDefinition;
  }): string {
    const columns = this.grantedSourceColumns(view)
      .map((column) => sqlText.quotedColumn(column))
      .join(", ");

    return (
      `GRANT SELECT(${columns}) ON ${sourceRelation({ names, sourceDatabase, view })} ` +
      `TO ${sqlText.assertIdentifier(names.restrictedUser, "restrictedUser")}`
    );
  }

  /** Column-scoped `SELECT` on a joined view's *second* source table. */
  joinSourceColumnGrantStatement({
    names,
    sourceDatabase,
    view,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    view: LangWatchQLViewDefinition;
  }): string | undefined {
    const { join } = view;
    if (!join) {
      return undefined;
    }

    const columns = [...new Set([...join.sourceColumns, ...(join.onSourceColumns?.joined ?? [])])]
      .map((column) => sqlText.quotedColumn(column))
      .join(", ");
    const relation = `${sqlText.assertIdentifier(sourceDatabase, "sourceDatabase")}.${sqlText.assertIdentifier(join.table, "join table")}`;

    return (
      `GRANT SELECT(${columns}) ON ${relation} ` +
      `TO ${sqlText.assertIdentifier(names.restrictedUser, "restrictedUser")}`
    );
  }
}
