/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog.
 * @see ./langwatch-ql-view-statements.service.ts — the ClickHouse views over them
 */
import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules";
import {
  DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
  LangWatchQLPostgresMappingService,
} from "./langwatch-ql-postgres-mapping.service";
import type { LangWatchQLNames } from "./langwatch-ql-access-model.service";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service";

const postgresMapping = LangWatchQLPostgresMappingService.create();

const catalogShapes = LangWatchQLCatalogShapesService.create();

/** The column every mapping renames: the tenant the row belongs to. */
const TENANT_COLUMN = "TenantId";

/**
 * The one column a mapped dataset's exposed column reads.
 */
function singleSourceColumn(view: LangWatchQLViewDefinition, columnName: string): string {
  const column = view.columns.find((candidate) => candidate.name === columnName);
  const [only] = column?.sourceColumns ?? [];
  if (!only || column?.sourceColumns.length !== 1) {
    throw new Error(
      `lwql views: PostgreSQL-resident column "${view.name}.${columnName}" must read ` +
        `exactly one source column; the approved view renames, it does not compute`,
    );
  }

  return only;
}

/** The PostgreSQL side of the catalog: approved views and the tables mapping them in. */
export class LangWatchQLPostgresViewsService {
  static create(): LangWatchQLPostgresViewsService {
    return new LangWatchQLPostgresViewsService();
  }

  private constructor() {}

  /**
   * The approved PostgreSQL views the catalog's PostgreSQL-resident datasets read, as
   * statements to run *against PostgreSQL*. The only statements this module produces that are
   * not ClickHouse SQL, and they are here rather than in a Prisma migration on purpose.
   */
  approvedViewStatements({
    schema,
    views = LWQL_VIEW_CATALOG,
  }: {
    /** PostgreSQL schema the application's tables live in. */
    schema: string;
    views?: readonly LangWatchQLViewDefinition[];
  }): string[] {
    return catalogShapes.postgresViews(views).map((view) =>
      postgresMapping.approvedViewStatement({
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
   * The approved views the reader role must be granted, in catalog order. No production caller
   * in this repo — input to the infra-owned access model (langwatch-saas#1126); reference
   * implementation, not dead code.
   */
  approvedViewNames(views: readonly LangWatchQLViewDefinition[] = LWQL_VIEW_CATALOG): string[] {
    return catalogShapes.postgresViews(views).map((view) => view.postgres.approvedView);
  }

  /**
   * Connections to allow the reader role, derived from the catalog rather than chosen.
   */
  readerConnectionLimit({
    views = LWQL_VIEW_CATALOG,
    connectionPoolSize = DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
    concurrentCatalogs = 1,
    headroom = 3,
  }: {
    views?: readonly LangWatchQLViewDefinition[];
    connectionPoolSize?: number;
    /**
     * ClickHouse deployments mapping this PostgreSQL role at once. One in production — a
     * LangWatchQL database per deployment.
     */
    concurrentCatalogs?: number;
    headroom?: number;
  } = {}): number {
    return (
      catalogShapes.postgresViews(views).length * connectionPoolSize * concurrentCatalogs + headroom
    );
  }

  /**
   * The PostgreSQL-engine tables mapping each approved view into the LangWatchQL database, as
   * ClickHouse statements. Run before {@link lwqlViewSetupStatements}, which builds the
   * LangWatchQL views over them, and after the named collection exists.
   */
  engineTableStatements({
    names,
    collection,
    views = LWQL_VIEW_CATALOG,
  }: {
    names: LangWatchQLNames;
    /** Named collection holding the PostgreSQL credentials. */
    collection: string;
    views?: readonly LangWatchQLViewDefinition[];
  }): string[] {
    return catalogShapes.postgresViews(views).map((view) =>
      postgresMapping.engineTableStatement({
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
}
