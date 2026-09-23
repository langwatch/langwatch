/**
 * What a self-hosted deploy provisions itself: the `LWQL_SELF_PROVISION` model
 * and the chart-managed PostgreSQL reader (`LWQL_MANAGE_POSTGRES_READER`).
 * @see specs/lwql/api.feature
 * @see specs/lwql/app-functions.feature
 */

import {
  LWQL_CONNECTION_DEFAULTS,
  lwqlDerivedConnectionFromEnv,
} from "../langwatch-ql/connection.ts";
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
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
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "./langwatch-ql-production-provisioning.service.ts";
import { LangWatchQLViewProvisioningService } from "./langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "./langwatch-ql-view-statements.service.ts";

const accessModel = LangWatchQLAccessModelService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();
const postgresViews = LangWatchQLPostgresViewsService.create();
const production = LangWatchQLProductionProvisioningService.create();
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

/** Whether the operator asked for self-provisioning, and whether its inputs arrived. */
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

/**
 * Who owns the PostgreSQL reader role on the explicit path: the chart-managed
 * pairing converges `lwql_ro` itself; everything else only re-grants views.
 */
export type LwqlPostgresReaderMode = "manage-role" | "grants-only";

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
    if (source.LWQL_SELF_PROVISION !== "true") return { requested: false };
    const connection = lwqlDerivedConnectionFromEnv(source);
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

  /** Keyed on the explicit flag, never on "a reader password happens to be present". */
  readerMode({ source }: { source: Record<string, string | undefined> }): LwqlPostgresReaderMode {
    return source.LWQL_MANAGE_POSTGRES_READER === "true" ? "manage-role" : "grants-only";
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
  }: {
    names: LangWatchQLNames;
    restrictedPassword: string;
    sourceDatabase: string;
    postgres: { endpoint: LwqlPostgresEndpoint; readerPassword: string };
    /** Off where a `CREATE FUNCTION` would reach one replica of several. */
    includeAppFunctions?: boolean;
  }): string[] {
    if (names.database !== sourceDatabase) {
      throw new Error(
        `lwql self-provisioning: the LangWatchQL database ("${names.database}") must be the application's own ClickHouse database ("${sourceDatabase}")`,
      );
    }
    const collection = LWQL_SELF_PROVISION_DEFAULTS.namedCollection;
    return [
      ...accessModel.setupStatements({
        names,
        password: restrictedPassword,
        lwqlTables: [],
        includeAppFunctions,
      }),
      ...postgresMapping.namedCollectionStatements({
        connection: {
          collection,
          host: postgres.endpoint.host,
          port: postgres.endpoint.port,
          database: postgres.endpoint.database,
          user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
          password: postgres.readerPassword,
        },
      }),
      ...catalogShapes
        .postgresViews(LWQL_VIEW_CATALOG)
        .map((view) => `DROP TABLE IF EXISTS ${accessModel.qualified(names, view.sourceTable)}`),
      ...postgresViews.engineTableStatements({ names, collection }),
      ...viewProvisioning.setupStatements({ names, sourceDatabase, dedup: SHIPPED_LWQL_DEDUP }),
    ];
  }

  /**
   * The reader-role statements for one ownership mode. Manage-role without a
   * password falls back to the default role's grants, with a warning.
   */
  postgresReaderStatements(
    input:
      | { mode: "manage-role"; readerPassword: string | undefined; schema: string }
      | { mode: "grants-only"; role: string | undefined; schema: string },
  ): { statements: string[]; warning?: string } {
    if (input.mode === "grants-only") {
      return {
        statements: production.postgresReaderGrantStatements({
          schema: input.schema,
          ...(input.role ? { role: input.role } : {}),
        }),
      };
    }
    if (!input.readerPassword) {
      return {
        statements: production.postgresReaderGrantStatements({ schema: input.schema }),
        warning:
          "LWQL_MANAGE_POSTGRES_READER is true but LWQL_POSTGRES_READER_PASSWORD is not set — cannot converge the reader role this boot; re-granting the approved views only",
      };
    }
    return {
      statements: postgresMapping.readerRoleStatements({
        reader: {
          role: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
          password: input.readerPassword,
          schema: input.schema,
          approvedViews: postgresViews.approvedViewNames(),
          connectionLimit: postgresViews.readerConnectionLimit(),
          statementTimeout: DEFAULT_POSTGRES_READER_LIMITS.statementTimeout,
        },
      }),
    };
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
