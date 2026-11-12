/**
 * How a view's source keeps one version per logical row: the strategy it is rendered with, the
 * `WHERE` clause of the in-tuple form, the FROM relation of the engine-level forms and the
 * grouping of the settled form (analytics ADR-005, ADR-006, ADR-007).
 */
import type { LangWatchQLDedupStrategy } from "../../../rules/lwql-view-dedup-shape.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "../../../services/langwatch-ql-sql-text.service.ts";
import { LWQL_SOURCE_ALIAS } from "../../lwql-catalogue/rules/lwql-source-alias.rules.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const sqlText = LangWatchQLSqlTextService.create();

/** The alias of a floored twin's hashed grain inside its dedup subquery. */
const FLOOR_GRAIN_KEY = "lwql_grain";

/** One of the source table's columns, qualified so no projection alias wins. */
function sourceColumn(name: string): string {
  return `${LWQL_SOURCE_ALIAS}.${sqlText.quotedColumn(name)}`;
}

/** The dedup half of a view's statement; the view statements service renders the rest. */
export class LangWatchQLViewDedupService {
  static create(): LangWatchQLViewDedupService {
    return new LangWatchQLViewDedupService();
  }

  private constructor() {}

  /**
   * The strategy one view is rendered with: its own where it pins one, and the caller's default
   * otherwise. The entry wins because the reason an entry pins a strategy is a property of its
   * source table that no default can be right about — see `SHIPPED_LWQL_DEDUP`.
   */
  strategyFor({
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
  predicate({
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
    const outerKeys = grain.map((column) => sourceColumn(column));
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

  /**
   * The `latest-in-order` relation (analytics ADR-006): the table read in sort-key order, newest
   * version first within each key, keeping one row per sort key and stable column. `LIMIT 1 BY`
   * streams over the read-in-order merge of the parts, and a filter on a key column prunes.
   */
  private latestInOrderRelation({
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
      `) AS ${LWQL_SOURCE_ALIAS}`
    );
  }

  /**
   * The `settled` relation (analytics ADR-007): the source columns the view reads, sign included,
   * from the floor on when the view is a floored twin. A retraction copies its row, so a version
   * and its retraction always fall on the same side of the floor.
   */
  settledRelation({
    view,
    relation,
    floor,
  }: {
    view: LangWatchQLViewDefinition;
    relation: string;
    /** The floored twin's lower bound on the floor column; absent, every row is read. */
    floor?: string;
  }): string {
    const signColumn = this.settledSign(view);
    const { floorColumn } = view.dedup;
    const columns = this.settledColumns(view).map((column) => sqlText.quotedColumn(column));
    const where =
      floor === undefined || floorColumn === undefined
        ? ""
        : `\n  WHERE ${sqlText.quotedColumn(catalogShapes.physicalColumn(view, floorColumn))} >= ${floor}`;
    return (
      `(\n  SELECT ${[...columns, sqlText.quotedColumn(signColumn)].join(", ")}\n` +
      `  FROM ${relation}${where}\n` +
      `) AS ${LWQL_SOURCE_ALIAS}`
    );
  }

  /**
   * A row-shaped settled view's `GROUP BY`: every column it reads but the sign, version included,
   * so each version is one group and a filter on any column reaches below the aggregation.
   */
  settledGroupKeys(view: LangWatchQLViewDefinition): string[] {
    return this.settledColumns(view).map((column) => sourceColumn(column));
  }

  /**
   * A settled view's `HAVING`: a group is live while its signs sum above zero, so an orphan
   * retraction never shows as a negative count (analytics ADR-007).
   */
  settledHaving(view: LangWatchQLViewDefinition): string {
    return `sum(${sourceColumn(this.settledSign(view))}) > 0`;
  }

  /** The sign column, refused where a settled view lacks what the form reads. */
  private settledSign(view: LangWatchQLViewDefinition): string {
    const { signColumn, versionColumn, aggregating } = view.dedup;
    if (!signColumn || (!versionColumn && !aggregating) || view.join) {
      throw new Error(
        `LangWatchQL view ${view.name} cannot use settled: it needs a sign column, a version ` +
          `column unless it aggregates, and no join`,
      );
    }
    return signColumn;
  }

  /** Every source column a settled view reads but the sign: key, version, then the rest. */
  private settledColumns(view: LangWatchQLViewDefinition): string[] {
    const { keyColumns, versionColumn, signColumn } = view.dedup;
    return [
      ...new Set([
        ...keyColumns.map((key) => catalogShapes.physicalColumn(view, key)),
        ...(versionColumn ? [versionColumn] : []),
        ...catalogShapes.viewSourceColumns(view),
      ]),
    ].filter((column) => column !== signColumn);
  }

  /** The view's FROM relation: its table read with the strategy's engine-level dedup, if any. */
  relation({
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
    const aliased = `${relation} AS ${LWQL_SOURCE_ALIAS}`;
    if (!engineDedup) return aliased;
    if (strategy === "final") return `${aliased} FINAL`;
    if (strategy === "latest-in-order") return this.latestInOrderRelation({ view, relation });
    return aliased;
  }
}
