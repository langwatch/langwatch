/**
 * What every LangWatchQL deployment provisions itself (ADR-159): the access model, the
 * PostgreSQL reader role and bridge, and the views.
 * @see specs/lwql/api.feature
 * @see specs/lwql/app-functions.feature
 */

import { createHash } from "node:crypto";

import {
  LWQL_CONNECTION_DEFAULTS,
  deriveLwqlConnectionFromEnv,
} from "../langwatch-ql/connection.ts";
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "./langwatch-ql-access-model-definition.service.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "./langwatch-ql-catalog-shapes.service.ts";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  LangWatchQLPostgresMappingService,
} from "./langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLPostgresViewsService } from "./langwatch-ql-postgres-views.service.ts";
import { LWQL_POSTGRES_READER_ROLE } from "./langwatch-ql-production-provisioning.service.ts";
import { LangWatchQLViewProvisioningService } from "./langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "./langwatch-ql-view-statements.service.ts";

const accessModel = LangWatchQLAccessModelService.create();
const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();
const postgresViews = LangWatchQLPostgresViewsService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();

/** The SaaS-convention names every self-provisioning distribution shares. */
export const LWQL_SELF_PROVISION_DEFAULTS = {
  ...LWQL_CONNECTION_DEFAULTS,
  postgresReaderRole: LWQL_POSTGRES_READER_ROLE,
  namedCollection: "lwql_postgres",
} as const;

/** The PostgreSQL endpoint the named collection dials, from `DATABASE_URL`. */
export type LwqlPostgresEndpoint = Readonly<{
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

/** The endpoint must be reachable from the ClickHouse server; the chart's cluster DNS is. */
function postgresEndpoints(databaseUrl: string | undefined): LwqlPostgresEndpoint[] {
  if (!databaseUrl) return [];
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return [];
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname || !database) return [];
  return [{ host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 5432, database }];
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
    const connection = deriveLwqlConnectionFromEnv(source);
    if (!connection) {
      return { requested: true, complete: false, missing: "the restricted connection" };
    }
    const postgresReaderPassword = source.LWQL_POSTGRES_READER_PASSWORD;
    if (!postgresReaderPassword) {
      return { requested: true, complete: false, missing: "LWQL_POSTGRES_READER_PASSWORD" };
    }
    const [endpoint] = postgresEndpoints(source.DATABASE_URL);
    if (!endpoint) {
      return { requested: true, complete: false, missing: "a parseable DATABASE_URL" };
    }
    return { requested: true, complete: true, connection, postgresReaderPassword, endpoint };
  }

  accessModelMode({ source }: { source: Record<string, string | undefined> }): LwqlAccessModelMode {
    return source.LWQL_ACCESS_MODEL_MODE === "sql" ? "sql" : "rendered";
  }

  /**
   * Every ClickHouse statement a self-provisioning boot runs: the access model,
   * the PostgreSQL bridge, then the views with their grants and policies. The
   * engine tables are dropped and recreated so a changed catalog converges.
   */
  clickHouseStatements({
    names,
    restrictedPassword,
    sourceDatabase,
    postgres,
    includeAppFunctions = true,
    mode = "sql",
  }: {
    names: LangWatchQLNames;
    restrictedPassword: string;
    sourceDatabase: string;
    postgres: { endpoint: LwqlPostgresEndpoint; readerPassword: string };
    /** Off where a `CREATE FUNCTION` would reach one replica of several. */
    includeAppFunctions?: boolean;
    /** `rendered` leaves the config-store-owned entities to the config files. */
    mode?: LwqlAccessModelMode;
  }): string[] {
    if (names.database !== sourceDatabase) {
      throw new Error(
        `lwql self-provisioning: the LangWatchQL database ("${names.database}") must be the application's own ClickHouse database ("${sourceDatabase}")`,
      );
    }
    const collection = LWQL_SELF_PROVISION_DEFAULTS.namedCollection;
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
    const engineTables = [
      ...catalogShapes
        .postgresViews(LWQL_VIEW_CATALOG)
        .map((view) => `DROP TABLE IF EXISTS ${accessModel.qualified(names, view.sourceTable)}`),
      ...postgresViews.engineTableStatements({ names, collection }),
    ];
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
