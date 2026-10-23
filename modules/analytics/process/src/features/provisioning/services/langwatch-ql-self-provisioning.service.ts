/**
 * What every LangWatchQL deployment provisions itself (ADR-159): the access model, the
 * PostgreSQL reader role and bridge, and the views.
 * @see specs/lwql/api.feature
 * @see specs/lwql/app-functions.feature
 */

import { createHash } from "node:crypto";

import type { LangWatchQLConnection } from "../../../repositories/langwatch-ql-executor.repository.ts";
import type { LwqlPostgresViewFound } from "../../../repositories/langwatch-ql-postgres.repository.ts";
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
  type PostgresNamedCollection,
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
  /** Each object absent, and each engine table not stamped with the current credentials. */
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
 * What the check found absent in each store (or, for an engine table, built on stale credentials);
 * both empty means converged. Columns are the deploy's, so an older worker never rewrites a newer
 * object. `unknown`: PostgreSQL could not be read, so it is neither converged nor cleared.
 */
export interface LwqlAppOwnedDrift {
  readonly clickHouse: readonly string[];
  readonly postgres: readonly LwqlPostgresGap[] | "unknown";
  readonly isKeyMapMissing: boolean;
}

/** The PostgreSQL connection the app expects the named collection to hold. */
type LwqlPostgresSettings = Readonly<{ endpoint: LwqlPostgresEndpoint; readerPassword: string }>;

/**
 * Two reads that together prove the collection holds the app's values: one through the collection,
 * one with the app's own values. The reader role has one password, so both succeeding means the
 * collection carries the app's (#8858).
 */
export interface LwqlCollectionProbe {
  readonly collection: string;
  /** An approved view the engine tables read; reading its structure authenticates. */
  readonly relation: string;
  readonly connection: Omit<PostgresNamedCollection, "collection">;
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

  /** Named collections are server-global: one per ClickHouse database, so stacks sharing a
   * server never overwrite each other's. */
  namedCollection({ names }: { names: LangWatchQLNames }): string {
    return `lwql_postgres_${names.database}`;
  }

  accessModelMode({ source }: { source: Record<string, string | undefined> }): LwqlAccessModelMode {
    return source.LWQL_ACCESS_MODEL_MODE === "sql" ? "sql" : "rendered";
  }

  /** The values the app renders into the named collection, in either mode. */
  namedCollectionValues({
    names,
    postgres,
  }: {
    names: LangWatchQLNames;
    postgres: LwqlPostgresSettings;
  }): PostgresNamedCollection {
    return {
      collection: this.namedCollection({ names }),
      host: postgres.endpoint.host,
      port: postgres.endpoint.port,
      database: postgres.endpoint.database,
      user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
      password: postgres.readerPassword,
    };
  }

  /** The fingerprint of {@link namedCollectionValues}, which a current engine table carries. */
  credentialFingerprint({
    names,
    postgres,
  }: {
    names: LangWatchQLNames;
    postgres: LwqlPostgresSettings;
  }): string {
    const { host, port, database, user, password } = this.namedCollectionValues({
      names,
      postgres,
    });
    return postgresMapping.credentialFingerprint({
      connection: { host, port, database, user, password },
    });
  }

  /** What to read before stamping an engine table with the app's collection values. */
  collectionProbe({
    names,
    postgres,
  }: {
    names: LangWatchQLNames;
    postgres: LwqlPostgresSettings;
  }): LwqlCollectionProbe {
    const { collection, ...connection } = this.namedCollectionValues({ names, postgres });
    const [first] = catalogShapes.postgresViews(LWQL_VIEW_CATALOG);
    if (!first) throw new Error("lwql self-provisioning: the catalog maps no PostgreSQL dataset");
    return { collection, relation: first.postgres.approvedView, connection };
  }

  /** The engine tables a converge creates: every one, or those among the check's drift. */
  engineTablesIn({ only }: { only: readonly string[] | undefined }): string[] {
    const engineTables = postgresViews.engineTableNames();
    return only === undefined ? engineTables : engineTables.filter((name) => only.includes(name));
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
    collectionLoaded = false,
  }: {
    names: LangWatchQLNames;
    restrictedPassword: string;
    sourceDatabase: string;
    postgres: LwqlPostgresSettings;
    /** Off where a `CREATE FUNCTION` would reach one replica of several. */
    includeAppFunctions?: boolean;
    /** `rendered` leaves the config-store-owned entities to the config files. */
    mode?: LwqlAccessModelMode;
    /** The reconvergence check's drift: only these app-owned objects, never the access entities. */
    only?: readonly string[];
    /** The task found ClickHouse holds the app's collection values: engine tables are stamped. */
    collectionLoaded?: boolean;
  }): string[] {
    if (names.database !== sourceDatabase) {
      throw new Error(
        `lwql self-provisioning: the LangWatchQL database ("${names.database}") must be the application's own ClickHouse database ("${sourceDatabase}")`,
      );
    }
    const collection = this.namedCollection({ names });
    const credentialFingerprint = collectionLoaded
      ? this.credentialFingerprint({ names, postgres })
      : undefined;
    if (only !== undefined) {
      return this.#driftedStatements({
        names,
        sourceDatabase,
        collection,
        includeAppFunctions,
        only,
        credentialFingerprint,
      });
    }
    const definition = accessModelDefinition.build({
      names,
      passwordSha256Hex: createHash("sha256").update(restrictedPassword).digest("hex"),
      namedCollection: this.namedCollectionValues({ names, postgres }),
      sourceDatabase,
    });
    const structural = accessModel.setupStatements({ names, sourceDatabase, includeAppFunctions });
    const engineTables = postgresViews.engineTableStatements({
      names,
      collection,
      ...(credentialFingerprint === undefined ? {} : { credentialFingerprint }),
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

  /** The drifted objects, and every view over an engine table that is about to be replaced. */
  #driftedStatements({
    names,
    sourceDatabase,
    collection,
    includeAppFunctions,
    only,
    credentialFingerprint,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    collection: string;
    includeAppFunctions: boolean;
    only: readonly string[];
    credentialFingerprint: string | undefined;
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
      ...postgresViews.engineTableStatements({
        names,
        collection,
        views: engineTables,
        ...(credentialFingerprint === undefined ? {} : { credentialFingerprint }),
      }),
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

  /**
   * Each expected relation absent or, for an engine table, not stamped with the current
   * credential fingerprint (a table from before #8858 has none); then each app function absent.
   */
  findDrift({
    names,
    relations,
    functions,
    found,
    credentialFingerprint,
  }: {
    names: LangWatchQLNames;
    relations: readonly string[];
    /** The app functions to expect; empty where a `CREATE FUNCTION` cannot reach every replica. */
    functions: readonly string[];
    found: {
      relations: readonly string[];
      functions: readonly string[];
      /** Each present relation's `system.tables` comment. */
      comments: Readonly<Record<string, string>>;
    };
    credentialFingerprint: string;
  }): LwqlClickHouseDrift {
    const engineTables = postgresViews.engineTableNames();
    const current = postgresMapping.credentialComment({ fingerprint: credentialFingerprint });
    const isStale = (name: string) =>
      engineTables.includes(name) && found.comments[name] !== current;
    const objects = [
      ...relations.filter((name) => !found.relations.includes(name) || isStale(name)),
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
