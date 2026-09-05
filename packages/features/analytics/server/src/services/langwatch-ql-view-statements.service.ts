/**
 * @see ./catalog/lwql-views.ts — the catalog these statements are built from
 * @see ./provisioning.ts — the access model applied over them
 * @see specs/analytics/lwql-api.feature
 */
import { TENANT_COLUMN } from "../rules/lwql-view-catalog.rules";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLDedupStrategy,
  type LangWatchQLViewColumn,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service";
import { KEY_MAP_COLUMNS, type LangWatchQLNames } from "./langwatch-ql-access-model.service";

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
const SOURCE_ALIAS = "src";

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

  const grain = catalogShapes.grainColumns(view);
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

  if (!column.summed) {
    throw new Error(
      `LangWatchQL view ${view.name} groups by its grain, and column "${column.name}" is neither part of ` +
        `the grain nor a summed measure, so it would take an arbitrary value from its group`,
    );
  }

  return catalogShapes.columnExpression({ column, source: sourceColumn, isAggregated: true });
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
    const strategy = dedupStrategyFor({ view, dedup });
    const grain = catalogShapes.grainColumns(view);
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
            : catalogShapes.columnExpression({ column, source: sourceColumn });

        return `  ${expression} AS ${sqlText.quotedColumn(column.name)}`;
      })
      .join(",\n");
    const aliased = `${relation} AS ${SOURCE_ALIAS}`;
    const from = strategy === "final" && !postgres && !grouped ? `${aliased} FINAL` : aliased;
    const where = postgres
      ? `\n${postgresTenantPredicate({ names })}`
      : strategy === "in-tuple"
        ? `\n${dedupPredicate(view, relation)}`
        : "";
    const groupBy = grouped ? `\nGROUP BY ${grain.map(sourceColumn).join(", ")}` : "";

    return (
      `CREATE OR REPLACE VIEW ` +
      `${sqlText.assertIdentifier(names.database, "database")}.${sqlText.assertIdentifier(view.name, "view")}\n` +
      `SQL SECURITY INVOKER\n` +
      `AS SELECT\n${projection}\n` +
      `FROM ${from}${where}${groupBy}`
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
}
