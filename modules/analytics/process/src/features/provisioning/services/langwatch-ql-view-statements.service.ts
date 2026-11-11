/**
 * @see ./catalog/lwql-views.ts — the catalog these statements are built from
 * @see ./provisioning.ts — the access model applied over them
 * @see specs/lwql/api.feature
 */
import { flooredViewName, LWQL_FLOOR_PARAMETER } from "../../../rules/lwql-dedup-floor.rules.ts";
import { TENANT_COLUMN } from "../../../rules/lwql-view-catalog.rules.ts";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
} from "../../../services/langwatch-ql-access-model.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLDedupStrategy,
  type LangWatchQLViewColumn,
  type LangWatchQLViewDefinition,
} from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "../../../services/langwatch-ql-sql-text.service.ts";
import { LWQL_SOURCE_ALIAS } from "../../lwql-catalogue/rules/lwql-source-alias.rules.ts";
import { postgresEngineColumnType } from "../rules/lwql-postgres-engine-type.rules.ts";

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
function postgresTenantPredicate({
  names,
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  /** Where the key map lives: in a real deploy, the app's own ClickHouse database (00084). */
  sourceDatabase: string;
}): string {
  // The key map is aliased and the inner reference qualified because the two relations name
  // their tenant column the same way: written bare, the identifier could bind to the outer
  // scope and turn this into a correlated subquery, which ClickHouse does not support and would
  // fail rather than silently widen — but failing at provisioning time is not a risk worth
  // taking for two characters.
  const keyMap = `${sqlText.assertIdentifier(sourceDatabase, "sourceDatabase")}.${sqlText.assertIdentifier(names.keyMapTable, "keyMapTable")}`;

  // A group project's session holds one hash per member, so the self-policy admits one row per
  // member and an equality kept only the first. `IN (subquery)` stays a set and is not pushed
  // down, so the bound is a min/max range of scalars: one tenant still sends an exact match, a
  // group sends the span of its members, and the row policy underneath decides the answer.
  const tenantId = `${KEY_MAP_ALIAS}.${sqlText.quotedColumn(KEY_MAP_COLUMNS.tenantId)}`;
  const bound = (fn: "min" | "max") =>
    `(SELECT ${fn}(${tenantId}) FROM ${keyMap} AS ${KEY_MAP_ALIAS})`;

  return (
    `WHERE ${sourceColumn(TENANT_COLUMN)} >= ${bound("min")}\n` +
    `  AND ${sourceColumn(TENANT_COLUMN)} <= ${bound("max")}`
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
function dedupPredicate({
  view,
  relation,
  floor,
}: {
  view: LangWatchQLViewDefinition;
  relation: string;
  /** The floored twin's lower bound on the floor column; absent, every version is read. */
  floor?: string;
}): string {
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

  // The floor column never falls between versions, so every row at or after the bound has its
  // latest version there too (analytics ADR-005).
  const { floorColumn } = view.dedup;
  if (floor === undefined || floorColumn === undefined) {
    return (
      `WHERE (${[...outerKeys, sourceColumn(versionColumn)].join(", ")}) IN (\n` +
      `    SELECT ${innerKeys.join(", ")}, max(${version})\n` +
      `    FROM ${relation}\n` +
      `    GROUP BY ${innerKeys.join(", ")}\n` +
      `  )`
    );
  }
  // The twin keeps only its window's versions, keyed by a 128-bit hash of the grain so the set
  // holds 16 bytes a row (analytics ADR-005).
  const column = catalogShapes.physicalColumn(view, floorColumn);
  return (
    `WHERE (sipHash128(${outerKeys.join(", ")}), ${sourceColumn(versionColumn)}) IN (\n` +
    `    SELECT sipHash128(${innerKeys.join(", ")}) AS ${FLOOR_GRAIN_KEY}, max(${version})\n` +
    `    FROM ${relation}\n` +
    `    WHERE ${sqlText.quotedColumn(column)} >= ${floor}\n` +
    `    GROUP BY ${FLOOR_GRAIN_KEY}\n` +
    `  )\n` +
    `  AND ${sourceColumn(column)} >= ${floor}`
  );
}

/** The alias of a floored twin's hashed grain inside its dedup subquery. */
const FLOOR_GRAIN_KEY = "lwql_grain";

/**
 * The `latest-in-order` relation (analytics ADR-006): the table read in sort-key order, newest
 * version first within each key, keeping one row per sort key and stable column. `LIMIT 1 BY`
 * streams over the read-in-order merge of the parts, and a filter on a key column prunes.
 */
function latestInOrderRelation({
  view,
  relation,
}: {
  view: LangWatchQLViewDefinition;
  relation: string;
}): string {
  const { versionColumn, tieBreakColumns = [], stableColumns = [] } = view.dedup;
  if (!versionColumn || view.dedup.aggregating || view.join) {
    throw new Error(
      `LangWatchQL view ${view.name} cannot use latest-in-order: it needs a version column, ` +
        `a source whose versions supersede each other, and no join`,
    );
  }
  const keyColumns = [
    ...new Set([
      ...view.dedup.keyColumns.map((key) => catalogShapes.physicalColumn(view, key)),
      ...stableColumns,
    ]),
  ].map((column) => sqlText.quotedColumn(column));
  const columns = [
    ...new Set([
      ...keyColumns,
      ...catalogShapes.viewSourceColumns(view).map((column) => sqlText.quotedColumn(column)),
    ]),
  ];
  const newestFirst = [versionColumn, ...tieBreakColumns].map(
    (column) => `${sqlText.quotedColumn(column)} DESC`,
  );
  return (
    `(\n  SELECT ${columns.join(", ")}\n` +
    `  FROM ${relation}\n` +
    `  ORDER BY ${[...keyColumns, ...newestFirst].join(", ")}\n` +
    `  LIMIT 1 BY ${keyColumns.join(", ")}\n` +
    `) AS ${SOURCE_ALIAS}`
  );
}

/** The view's FROM relation: its table read with the strategy's engine-level dedup, if any. */
function dedupedRelation({
  view,
  relation,
  strategy,
  engineDedup,
}: {
  view: LangWatchQLViewDefinition;
  relation: string;
  strategy: LangWatchQLDedupStrategy;
  engineDedup: boolean;
}): string {
  const aliased = `${relation} AS ${SOURCE_ALIAS}`;
  if (!engineDedup) return aliased;
  if (strategy === "final") return `${aliased} FINAL`;
  if (strategy === "latest-in-order") return latestInOrderRelation({ view, relation });
  return aliased;
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
      joined: deriveJoinedColumnQualifier(view),
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
 * approved view already renamed, a date cast back to its catalogue type), the
 * grouped form under `GROUP BY`, else the column's own expression.
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
    const source = sourceColumn(column.name);
    // The engine table widens a date to read it right; the view keeps the catalogue's type.
    return postgresEngineColumnType(column.type) === column.type
      ? source
      : `CAST(${source} AS ${column.type})`;
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
function deriveJoinedColumnQualifier(
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
    floor,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    view: LangWatchQLViewDefinition;
    dedup: LangWatchQLDedupStrategy;
    /** Renders the floored twin, whose dedup reads only versions from this bound. */
    floor?: string;
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
    const joinedColumn = deriveJoinedColumnQualifier(view);
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
    const from = dedupedRelation({ view, relation, strategy, engineDedup: !postgres && !grouped });
    const joinClause = joinRelationClause(view, sourceDatabase);
    const enginePredicate =
      strategy === "in-tuple"
        ? `\n${dedupPredicate({ view, relation, ...(floor === undefined ? {} : { floor }) })}`
        : "";
    const where = postgres
      ? `\n${postgresTenantPredicate({ names, sourceDatabase })}`
      : enginePredicate;
    const preFilter = preFilterClause(view, where);
    const groupBy = grouped
      ? `\nGROUP BY ${grain.map((column) => sourceColumn(catalogShapes.physicalColumn(view, column))).join(", ")}`
      : "";

    return (
      `CREATE OR REPLACE VIEW ` +
      `${sqlText.assertIdentifier(names.database, "database")}.${sqlText.assertIdentifier(floor === undefined ? view.name : flooredViewName(view.name), "view")}\n` +
      `SQL SECURITY INVOKER\n` +
      `AS SELECT\n${projection}\n` +
      `FROM ${from}${joinClause}${where}${preFilter}${groupBy}`
    );
  }

  /**
   * `CREATE OR REPLACE VIEW` for a view's floored twin (analytics ADR-005): a parameterised view
   * the executor reads in place of the view when the statement bounds the floor column below.
   * None for a view whose dedup declares no floor column.
   */
  flooredViewStatements({
    names,
    sourceDatabase,
    view,
    dedup,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    view: LangWatchQLViewDefinition;
    dedup: LangWatchQLDedupStrategy;
  }): string[] {
    const { floorColumn } = view.dedup;
    const columns = view.columns.filter((column) => column.name === floorColumn);
    if (dedupStrategyFor({ view, dedup }) !== "in-tuple") return [];
    // The twin reads its bound from a parameter typed like the floor column.
    return columns.map((column) =>
      this.viewStatement({
        names,
        sourceDatabase,
        view,
        dedup,
        floor: `{${LWQL_FLOOR_PARAMETER}:${column.type}}`,
      }),
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
  buildJoinSourceColumnGrantStatement({
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
