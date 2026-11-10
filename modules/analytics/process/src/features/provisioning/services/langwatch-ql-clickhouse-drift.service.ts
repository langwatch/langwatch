/**
 * Which app-owned ClickHouse relations have drifted from the catalog (ADR-159).
 * @see specs/lwql/api.feature
 */
import { LWQL_VIEW_CATALOG, pickLwqlViewByName } from "../../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../../services/langwatch-ql-catalog-shapes.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();

/** What the probe found in ClickHouse for the relations it looked at. */
export type LwqlRelationsFound = Readonly<{
  relations: readonly string[];
  /** Each present relation's `system.tables` comment. */
  comments: Readonly<Record<string, string>>;
  /** Each present relation's column names. */
  columns: Readonly<Record<string, readonly string[]>>;
}>;

export class LangWatchQLClickHouseDriftService {
  static create(): LangWatchQLClickHouseDriftService {
    return new LangWatchQLClickHouseDriftService();
  }

  /** The relations absent, stamped with other credentials, or lacking a catalog column. */
  relationsToRebuild({
    relations,
    found,
    engineTables,
    currentComment,
  }: {
    relations: readonly string[];
    found: LwqlRelationsFound;
    engineTables: readonly string[];
    currentComment: string;
  }): string[] {
    const isStale = (name: string) =>
      engineTables.includes(name) && found.comments[name] !== currentComment;
    // Only a missing column is drift, never an extra one (specs/lwql/api.feature, rolling deploys).
    const lacksColumns = (name: string) => {
      const view = pickLwqlViewByName(name);
      const held = found.columns[name];
      return !!view && !!held && view.columns.some((column) => !held.includes(column.name));
    };
    // A PostgreSQL-backed view reads its engine table's columns, so that table is rebuilt too.
    const widened = new Set(
      catalogShapes
        .postgresViews(LWQL_VIEW_CATALOG)
        .filter((view) => lacksColumns(view.name))
        .map((view) => view.sourceTable),
    );
    return relations.filter(
      (name) =>
        !found.relations.includes(name) || isStale(name) || lacksColumns(name) || widened.has(name),
    );
  }
}
