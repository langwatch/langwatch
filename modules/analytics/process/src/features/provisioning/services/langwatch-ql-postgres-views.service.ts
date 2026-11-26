/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog.
 * @see ./langwatch-ql-view-statements.service.ts — the ClickHouse views over them
 */
import { LWQL_VIEW_CATALOG } from "../../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../../services/langwatch-ql-access-model.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLPostgresMapping,
  type LangWatchQLViewDefinition,
} from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "../../../services/langwatch-ql-sql-text.service.ts";
import { postgresEngineColumnType } from "../rules/lwql-postgres-engine-type.rules.ts";
import {
  LWQL_SCOPED_SCHEMA,
  LWQL_PROJECT_KEYS_VIEW,
  scopedCopiesWritableCondition,
} from "../rules/lwql-scoped-view.rules.ts";
import {
  DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
  LangWatchQLPostgresMappingService,
  POSTGRES_BASE_ALIAS,
} from "./langwatch-ql-postgres-mapping.service.ts";

const postgresMapping = LangWatchQLPostgresMappingService.create();
const sqlText = LangWatchQLSqlTextService.create();

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

/** One dataset's view body: the relations it reads in `schema`, and the tenant's alias. */
function approvedViewShape({
  schema,
  view,
}: {
  schema: string;
  view: LangWatchQLViewDefinition & { postgres: LangWatchQLPostgresMapping };
}) {
  const joins = view.postgres.tenantPath ?? [];
  // The project column lives on the last hop's relation (the base itself
  // when the path is empty), so the tenant column is read on that alias
  // while every other column reads off the base.
  const tenantAlias = joins[joins.length - 1]?.alias ?? POSTGRES_BASE_ALIAS;
  const tenant = { alias: tenantAlias, column: view.postgres.tenantSourceColumn };

  return {
    tenant,
    statement: {
      schema,
      view: view.postgres.approvedView,
      baseRelation: view.postgres.baseRelation,
      joins,
      ...(view.postgres.rowFilter !== undefined ? { rowFilter: view.postgres.rowFilter } : {}),
      columns: view.columns.map((column) => ({
        exposed: column.name,
        // The tenant column is the one rename every mapping performs; the rest
        // are the base relation's own names, taken from the catalog.
        source:
          column.name === TENANT_COLUMN ? tenant.column : singleSourceColumn(view, column.name),
        ...(column.name === TENANT_COLUMN ? { alias: tenant.alias } : {}),
      })),
    },
  };
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
    readerRole,
  }: {
    /** PostgreSQL schema the application's tables live in. */
    schema: string;
    views?: readonly LangWatchQLViewDefinition[];
    /**
     * Re-granted `SELECT` by each statement's fallback branch, when the caller
     * knows the reader role at this point. Omitted for a pure catalog
     * derivation with no runtime reader identity.
     */
    readerRole?: string;
  }): string[] {
    return catalogShapes.postgresViews(views).map((view) =>
      postgresMapping.approvedViewStatement({
        ...approvedViewShape({ schema, view }).statement,
        ...(readerRole !== undefined ? { readerRole } : {}),
      }),
    );
  }

  /**
   * The scoped copies: each approved view, same name, in {@link LWQL_SCOPED_SCHEMA}, reading the
   * base tables in `schema` with the row scope. Each runs only when the group exists and the
   * scoped schema is this installation's.
   */
  scopedViewStatements({
    schema,
    views = LWQL_VIEW_CATALOG,
  }: {
    /** PostgreSQL schema the application's tables live in. */
    schema: string;
    views?: readonly LangWatchQLViewDefinition[];
  }): string[] {
    const onlyWhen = scopedCopiesWritableCondition({ appSchema: schema });

    return catalogShapes.postgresViews(views).map((view) => {
      const shape = approvedViewShape({ schema, view });

      return postgresMapping.approvedViewStatement({
        ...shape.statement,
        rowScope: { tenant: shape.tenant },
        viewSchema: LWQL_SCOPED_SCHEMA,
        onlyWhen,
      });
    });
  }

  /**
   * The scoped copy of project keys: each project's `lower-hex sha256(lwqlKey)` and id, row-scoped
   * like the other copies. The hash is the exact token the app's key map stores
   * (`createHash("sha256").update(key).digest("hex")`), so the ClickHouse side compares equal.
   */
  projectKeysScopedViewStatement({ schema }: { schema: string }): string {
    const base = sqlText.postgresQuoted(POSTGRES_BASE_ALIAS);
    return postgresMapping.approvedViewStatement({
      schema,
      view: LWQL_PROJECT_KEYS_VIEW,
      baseRelation: "Project",
      columns: [
        {
          exposed: "KeyHash",
          expression: `encode(sha256(convert_to(${base}."lwqlKey", 'UTF8')), 'hex')`,
        },
        { exposed: "TenantId", source: "id" },
      ],
      rowFilter: `coalesce(${base}."lwqlKey", '') <> ''`,
      rowScope: { tenant: { alias: POSTGRES_BASE_ALIAS, column: "id" } },
      viewSchema: LWQL_SCOPED_SCHEMA,
      onlyWhen: scopedCopiesWritableCondition({ appSchema: schema }),
    });
  }

  /**
   * The ClickHouse key map of a private server: a PostgreSQL-engine table over the scoped
   * project-key copy, bound to the collection the server's config mounts. It carries no rows.
   */
  keyMapEngineTableStatement({
    names,
    collection,
    schema,
  }: {
    names: LangWatchQLNames;
    collection: string;
    schema: string;
  }): string {
    return postgresMapping.engineTableStatement({
      names,
      table: names.keyMapTable,
      columns: [
        { name: "KeyHash", type: "String" },
        { name: "TenantId", type: "String" },
      ],
      collection,
      postgresRelation: LWQL_PROJECT_KEYS_VIEW,
      schema,
    });
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

  /** The ClickHouse PostgreSQL-engine tables the catalog maps, each named once. */
  engineTableNames(views: readonly LangWatchQLViewDefinition[] = LWQL_VIEW_CATALOG): string[] {
    return [...new Set(catalogShapes.postgresViews(views).map((view) => view.sourceTable))];
  }

  /**
   * The PostgreSQL-engine tables mapping each approved view into the LangWatchQL database, as
   * ClickHouse statements. Run before {@link lwqlViewSetupStatements}, which builds the
   * LangWatchQL views over them, and after the named collection exists.
   */
  engineTableStatements({
    names,
    collection,
    schema,
    views = LWQL_VIEW_CATALOG,
    credentialFingerprint,
  }: {
    names: LangWatchQLNames;
    /** Named collection holding the PostgreSQL credentials. */
    collection: string;
    /** The app PostgreSQL schema the engine tables read from. */
    schema: string;
    views?: readonly LangWatchQLViewDefinition[];
    /** The collection values' fingerprint, once ClickHouse is known to hold them. */
    credentialFingerprint?: string;
  }): string[] {
    return catalogShapes.postgresViews(views).map((view) =>
      postgresMapping.engineTableStatement({
        names,
        table: view.sourceTable,
        columns: view.columns.map((column) => ({
          name: column.name,
          type: postgresEngineColumnType(column.type),
        })),
        collection,
        postgresRelation: view.postgres.approvedView,
        schema,
        ...(credentialFingerprint === undefined ? {} : { credentialFingerprint }),
      }),
    );
  }
}
