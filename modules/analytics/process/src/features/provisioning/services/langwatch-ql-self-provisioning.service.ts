/**
 * What every LangWatchQL deployment provisions itself (ADR-159): the access model, the
 * PostgreSQL reader role and bridge, and the views.
 * @see specs/lwql/api.feature
 * @see specs/lwql/app-functions.feature
 */

import { createHash } from "node:crypto";

import type { LangWatchQLConnection } from "../../../repositories/langwatch-ql-executor.repository.ts";
import type { LwqlPostgresViewFound } from "../../../repositories/langwatch-ql-postgres.repository.ts";
import type { LwqlCollectionState } from "../../../repositories/langwatch-ql-provisioning.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "../../../services/langwatch-ql-access-model-definition.service.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "../../../services/langwatch-ql-access-model.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  LangWatchQLConnectionService,
  LWQL_CONNECTION_DEFAULTS,
} from "../../../services/langwatch-ql-connection.service.ts";
import { LWQL_APP_FUNCTION_CATALOG } from "../../app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import { LangWatchQLAppFunctionStatementsService } from "./langwatch-ql-app-function-statements.service.ts";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  LangWatchQLPostgresMappingService,
} from "./langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLPostgresViewsService } from "./langwatch-ql-postgres-views.service.ts";
import { LWQL_POSTGRES_READER_ROLE } from "./langwatch-ql-production-provisioning.service.ts";
import { LangWatchQLViewProvisioningService } from "./langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "./langwatch-ql-view-statements.service.ts";

const accessModel = LangWatchQLAccessModelService.create();
const appFunctionStatements = LangWatchQLAppFunctionStatementsService.create();
const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();
const connections = LangWatchQLConnectionService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();
const postgresViews = LangWatchQLPostgresViewsService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();

/** The SaaS-convention names every self-provisioning distribution shares. */
export const LWQL_SELF_PROVISION_DEFAULTS = {
  ...LWQL_CONNECTION_DEFAULTS,
  postgresReaderRole: LWQL_POSTGRES_READER_ROLE,
} as const;

/** The collection a config store delivers; every released chart install binds to this name. */
export const LWQL_RENDERED_NAMED_COLLECTION = "lwql_postgres";

/** Nothing read: every rendered-mode engine table takes the preferred collection. */
export const NO_COLLECTION_STATE: LwqlCollectionState = { available: [], bound: {} };

/** The PostgreSQL endpoint the named collection dials, from `DATABASE_URL`. */
type LwqlPostgresEndpoint = Readonly<{
  host: string;
  port: number;
  database: string;
}>;

/** Whether this deployment runs LangWatchQL at all, and whether its inputs arrived. */
export type LwqlSelfProvisionRequest =
  | { readonly requested: false }
  | { readonly requested: true; readonly complete: false; readonly missing: string }
  | {
      readonly requested: true;
      readonly complete: true;
      readonly connection: LangWatchQLConnection;
      readonly postgresReaderPassword: string;
      readonly endpoint: LwqlPostgresEndpoint;
    };

/** `rendered`: a config store owns user, profile, policies and collection; `sql`: the app does. */
export type LwqlAccessModelMode = "rendered" | "sql";

/** What the app-owned ClickHouse objects lack; names only, never DDL. */
interface LwqlClickHouseDrift {
  /** Each object absent. */
  readonly objects: readonly string[];
  /** The key map was among them, so a converge that repairs it is followed by a fill. */
  readonly isKeyMapMissing: boolean;
}

/** An approved view the check repairs: created when absent, then granted to the reader. */
export interface LwqlPostgresGap {
  readonly view: string;
  readonly absent: boolean;
}

/**
 * What the check found absent in each store; both empty means converged. Columns are the
 * deploy's, so an older worker never rewrites a newer object. `unknown`: PostgreSQL could not
 * be read, so it is neither converged nor cleared.
 */
export interface LwqlAppOwnedDrift {
  readonly clickHouse: readonly string[];
  readonly postgres: readonly LwqlPostgresGap[] | "unknown";
  readonly isKeyMapMissing: boolean;
}

/** The endpoint must be reachable from the ClickHouse server; the chart's cluster DNS is. */
function postgresEndpoints({
  databaseUrl,
  host,
}: {
  databaseUrl: string | undefined;
  host: string | undefined;
}): LwqlPostgresEndpoint[] {
  if (!databaseUrl) return [];
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return [];
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname || !database) return [];
  return [
    { host: host || parsed.hostname, port: parsed.port ? Number(parsed.port) : 5432, database },
  ];
}

/** The self-hosted provisioning statements, and the environment that selects them. */
export class LangWatchQLSelfProvisioningService {
  static create(): LangWatchQLSelfProvisioningService {
    return new LangWatchQLSelfProvisioningService();
  }

  private constructor() {}

  /**
   * The mode is whichever one the operator asked for, never whichever one's
   * inputs happened to arrive: an incomplete request is declined, not demoted.
   */
  request({ source }: { source: Record<string, string | undefined> }): LwqlSelfProvisionRequest {
    if (!source.LWQL_CLICKHOUSE_PASSWORD) return { requested: false };
    const connection = connections.deriveFromSource({ source });
    if (!connection) {
      return { requested: true, complete: false, missing: "the restricted connection" };
    }
    const postgresReaderPassword = source.LWQL_POSTGRES_READER_PASSWORD;
    if (!postgresReaderPassword) {
      return { requested: true, complete: false, missing: "LWQL_POSTGRES_READER_PASSWORD" };
    }
    const [endpoint] = postgresEndpoints({
      databaseUrl: source.DATABASE_URL,
      host: source.LWQL_POSTGRES_HOST,
    });
    if (!endpoint) {
      return { requested: true, complete: false, missing: "a parseable DATABASE_URL" };
    }
    return { requested: true, complete: true, connection, postgresReaderPassword, endpoint };
  }

  /**
   * Rendered mode keeps `lwql_postgres`: the server's own config store holds it, and released
   * installs bound their engine tables to it, so a rename detaches them on the next restart.
   * In sql mode one server can hold several stacks, so each database gets its own.
   */
  namedCollection({ names, mode }: { names: LangWatchQLNames; mode: LwqlAccessModelMode }): string {
    return mode === "rendered" ? LWQL_RENDERED_NAMED_COLLECTION : `lwql_postgres_${names.database}`;
  }

  /**
   * Both names a rendered-mode engine table may be bound to, preferred first: the one released
   * config stores mount, then the per-database one a server outside the chart may hold.
   */
  renderedCollectionCandidates({ names }: { names: LangWatchQLNames }): string[] {
    return [LWQL_RENDERED_NAMED_COLLECTION, this.namedCollection({ names, mode: "sql" })];
  }

  /**
   * The names config.d delivers beside `lwql_postgres`, so a table a previous config bound to
   * the per-database name still attaches once the pods roll onto this one.
   */
  renderedCollectionAliases({ names }: { names: LangWatchQLNames }): string[] {
    return this.renderedCollectionCandidates({ names }).filter(
      (name) => name !== LWQL_RENDERED_NAMED_COLLECTION,
    );
  }

  /**
   * A rendered-mode engine table keeps its binding while that candidate exists on the server,
   * else takes the first candidate the server holds. With neither visible it takes the
   * preferred name, so the statement fails where the collection is truly absent.
   */
  renderedCollectionFor({
    names,
    table,
    server,
  }: {
    names: LangWatchQLNames;
    table: string;
    server: LwqlCollectionState;
  }): string {
    const candidates = this.renderedCollectionCandidates({ names });
    const bound = server.bound[table];
    if (bound !== undefined && candidates.includes(bound) && server.available.includes(bound)) {
      return bound;
    }
    return (
      candidates.find((name) => server.available.includes(name)) ?? LWQL_RENDERED_NAMED_COLLECTION
    );
  }

  accessModelMode({ source }: { source: Record<string, string | undefined> }): LwqlAccessModelMode {
    return source.LWQL_ACCESS_MODEL_MODE === "sql" ? "sql" : "rendered";
  }

  /**
   * Every ClickHouse statement a self-provisioning boot runs: the access model, the PostgreSQL
   * bridge, then the views. Each app-owned object is created or replaced in one statement,
   * never dropped first, so a failed run leaves the working objects in place (issue #8726).
   */
  clickHouseStatements({
    names,
    restrictedPassword,
    sourceDatabase,
    postgres,
    includeAppFunctions = true,
    mode = "sql",
    only,
    server = NO_COLLECTION_STATE,
  }: {
    names: LangWatchQLNames;
    restrictedPassword: string;
    sourceDatabase: string;
    postgres: { endpoint: LwqlPostgresEndpoint; readerPassword: string };
    /** Off where a `CREATE FUNCTION` would reach one replica of several. */
    includeAppFunctions?: boolean;
    /** `rendered` leaves the config-store-owned entities to the config files. */
    mode?: LwqlAccessModelMode;
    /** The reconvergence check's drift: only these app-owned objects, never the access entities. */
    only?: readonly string[];
    /** Rendered mode: the collections the server holds and each engine table's binding. */
    server?: LwqlCollectionState;
  }): string[] {
    if (names.database !== sourceDatabase) {
      throw new Error(
        `lwql self-provisioning: the LangWatchQL database ("${names.database}") must be the application's own ClickHouse database ("${sourceDatabase}")`,
      );
    }
    const collection = this.namedCollection({ names, mode });
    const collectionFor = (table: string) =>
      mode === "rendered" ? this.renderedCollectionFor({ names, table, server }) : collection;
    if (only !== undefined) {
      return this.#driftedStatements({
        names,
        sourceDatabase,
        collectionFor,
        includeAppFunctions,
        only,
      });
    }
    const definition = accessModelDefinition.build({
      names,
      passwordSha256Hex: createHash("sha256").update(restrictedPassword).digest("hex"),
      namedCollection: {
        collection,
        host: postgres.endpoint.host,
        port: postgres.endpoint.port,
        database: postgres.endpoint.database,
        user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
        password: postgres.readerPassword,
      },
      sourceDatabase,
    });
    const structural = accessModel.setupStatements({ names, sourceDatabase, includeAppFunctions });
    const engineTables = this.#engineTableStatements({
      names,
      collectionFor,
      views: catalogShapes.postgresViews(LWQL_VIEW_CATALOG),
    });
    const views = viewProvisioning.setupStatements({
      names,
      sourceDatabase,
      dedup: SHIPPED_LWQL_DEDUP,
    });
    if (mode === "rendered") return [...structural, ...engineTables, ...views];
    return [
      ...structural,
      ...accessModelDefinition.renderNamedCollectionDdl(definition),
      ...engineTables,
      ...views,
      ...accessModelDefinition.renderDdl(definition),
    ];
  }

  /** One engine table per PostgreSQL dataset, each on the collection `collectionFor` picks. */
  #engineTableStatements({
    names,
    collectionFor,
    views,
  }: {
    names: LangWatchQLNames;
    collectionFor: (table: string) => string;
    views: readonly LangWatchQLViewDefinition[];
  }): string[] {
    return views.flatMap((view) =>
      postgresViews.engineTableStatements({
        names,
        collection: collectionFor(view.sourceTable),
        views: [view],
      }),
    );
  }

  /** The drifted objects, and every view over an engine table that is about to be replaced. */
  #driftedStatements({
    names,
    sourceDatabase,
    collectionFor,
    includeAppFunctions,
    only,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    collectionFor: (table: string) => string;
    includeAppFunctions: boolean;
    only: readonly string[];
  }): string[] {
    const drifted = new Set(only);
    const engineTables = catalogShapes
      .postgresViews(LWQL_VIEW_CATALOG)
      .filter((view) => drifted.has(view.sourceTable));
    const replaced = new Set(engineTables.map((view) => view.sourceTable));
    const views = LWQL_VIEW_CATALOG.filter(
      (view) =>
        drifted.has(view.name) ||
        (catalogShapes.isPostgresResident(view) && replaced.has(view.sourceTable)),
    );
    const functions = includeAppFunctions
      ? LWQL_APP_FUNCTION_CATALOG.filter((definition) => drifted.has(definition.name))
      : [];
    return [
      ...appFunctionStatements.functionStatements({ functions }),
      ...(drifted.has(names.keyMapTable)
        ? [accessModel.keyMapTableStatement({ names, sourceDatabase })]
        : []),
      ...this.#engineTableStatements({ names, collectionFor, views: engineTables }),
      ...viewProvisioning.setupStatements({
        names,
        sourceDatabase,
        views,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    ];
  }

  /** The catalog datasets whose approved PostgreSQL view is among `approvedViews`. */
  postgresDatasets({
    approvedViews,
  }: {
    approvedViews: readonly string[];
  }): LangWatchQLViewDefinition[] {
    return catalogShapes
      .postgresViews(LWQL_VIEW_CATALOG)
      .filter((view) => approvedViews.includes(view.postgres.approvedView));
  }

  /** The reader role converged on every path: the app owns `lwql_ro` (ADR-159). */
  postgresReaderStatements({
    readerPassword,
    schema,
  }: {
    readerPassword: string;
    schema: string;
  }): string[] {
    return postgresMapping.readerRoleStatements({
      reader: {
        role: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
        password: readerPassword,
        schema,
        approvedViews: postgresViews.approvedViewNames(),
        connectionLimit: postgresViews.readerConnectionLimit(),
        statementTimeout: DEFAULT_POSTGRES_READER_LIMITS.statementTimeout,
      },
    });
  }

  /** The relations a rendered-mode converge creates: the key map, engine tables and views. */
  appOwnedRelations({ names }: { names: LangWatchQLNames }): string[] {
    return [
      names.keyMapTable,
      ...catalogShapes.postgresViews(LWQL_VIEW_CATALOG).map((view) => view.sourceTable),
      ...LWQL_VIEW_CATALOG.map((view) => view.name),
    ];
  }

  /** Each expected relation absent, then each expected app function absent. */
  findDrift({
    names,
    relations,
    functions,
    found,
  }: {
    names: LangWatchQLNames;
    relations: readonly string[];
    /** The app functions to expect; empty where a `CREATE FUNCTION` cannot reach every replica. */
    functions: readonly string[];
    found: { relations: readonly string[]; functions: readonly string[] };
  }): LwqlClickHouseDrift {
    const objects = [
      ...relations.filter((name) => !found.relations.includes(name)),
      ...functions.filter((name) => !found.functions.includes(name)),
    ];
    return { objects, isKeyMapMissing: objects.includes(names.keyMapTable) };
  }

  /** The approved views the reader role must select from. */
  approvedPostgresViews(): string[] {
    return postgresViews.approvedViewNames();
  }

  /** Each approved view absent, or present but not selectable by the reader. */
  findPostgresGaps({ found }: { found: readonly LwqlPostgresViewFound[] }): LwqlPostgresGap[] {
    const byName = new Map(found.map((view) => [view.view, view]));
    return this.approvedPostgresViews()
      .filter((view) => byName.get(view)?.granted !== true)
      .map((view) => ({ view, absent: !byName.has(view) }));
  }

  /** A failed statement echoes its DDL, which embeds passwords; every logged error passes here. */
  redactSecrets({
    text,
    secrets,
  }: {
    text: string;
    secrets: readonly (string | undefined)[];
  }): string {
    let redacted = text;
    for (const secret of secrets) {
      if (secret) redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  }
}
