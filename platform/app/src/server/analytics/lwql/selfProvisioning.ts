/**
 * LangWatchQL self-provisioning — the deployment mode where the application
 * itself owns the whole access model (issue #6635).
 *
 * The SaaS cloud provisions the restricted identity, profile, grants, row
 * policies, named collection and reader role out of band (terraform,
 * langwatch-saas#1126), so the app there only ever *uses* the five `LWQL_*`
 * values. A self-hosted install has no terraform: it holds admin credentials
 * for both stores by construction (`CLICKHOUSE_URL`, `DATABASE_URL`), and this
 * module is what turns those into a working LangWatchQL deployment on every
 * boot — `LWQL_SELF_PROVISION=true` plus two generated passwords in, the five
 * `LWQL_*` values derived, every access-model object converged idempotently.
 *
 * Two halves, matching the split the rest of the module keeps:
 *
 *  - **Env derivation** ({@link lwqlSelfProvisionFromEnv}) — builds the
 *    restricted connection the executor serves with, from the admin URLs and
 *    SaaS-convention default names. Pure over its `env` argument.
 *  - **Statement composition** ({@link selfHostedClickHouseProvisioningStatements},
 *    {@link selfHostedPostgresReaderStatements}) — sequences the reference
 *    builders (`provisioning.ts`, `postgresMapping.ts`, `views.ts`) in the
 *    order the integration harness proves works: access model, bridge,
 *    views. Pure; `src/tasks/provisionLwql.ts` is the only caller with I/O.
 *
 * The names default to the SaaS ones on purpose — one convention across every
 * distribution, so a self-hosted operator reading the docs and a cloud
 * operator reading terraform see the same objects.
 *
 * @see specs/analytics/lwql-api.feature
 */

import { createLogger } from "@langwatch/observability";

import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import { lwqlPostgresViews } from "./catalog/types";
import type { LangWatchQLConnection } from "./executor";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  postgresNamedCollectionStatements,
  postgresReaderRoleStatements,
} from "./postgresMapping";
import { LWQL_POSTGRES_READER_ROLE } from "./productionProvisioning";
import {
  type LangWatchQLNames,
  lwqlClickHouseSetupStatements,
  qualified,
} from "./provisioning";
import {
  lwqlApprovedPostgresViewNames,
  lwqlPostgresEngineTableStatements,
  lwqlPostgresReaderConnectionLimit,
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "./views";

const logger = createLogger("langwatch:analytics:lwql:selfProvisioning");

/**
 * The SaaS-convention names, shared by every distribution that self-provisions.
 *
 * `restrictedUser` and `tenantSetting` mirror what terraform provisions in the
 * cloud (`langwatch-saas#1126`); `postgresReaderRole` and `namedCollection`
 * mirror the bridge objects there (`lwql_ro`, `lwql_postgres`). Diverging
 * self-hosted names would mean two vocabularies for one model.
 */
export const LWQL_SELF_PROVISION_DEFAULTS = {
  restrictedUser: "langwatch_lwql",
  tenantSetting: "custom_api_key_hash",
  postgresReaderRole: LWQL_POSTGRES_READER_ROLE,
  namedCollection: "lwql_postgres",
} as const;

/** Everything the provisioning task needs beyond the serving connection. */
export interface LwqlSelfProvisionEnv {
  /** The restricted connection, identical to what the executor serves with. */
  connection: LangWatchQLConnection;
  /** Password the reader role is converged to and the collection dials with. */
  postgresReaderPassword: string;
}

/**
 * Derives the restricted ClickHouse connection from the admin URL.
 *
 * The LangWatchQL database is the admin URL's own database, exactly as the
 * cloud deploys it: the views live beside the fact tables, and the key-map
 * row policies reference the same database the migration created the table
 * in. An explicit `LWQL_DATABASE` naming a *different* database is refused
 * (null, logged) rather than honoured — the backfill would write one key map
 * while every row policy reads another, which is a silent all-queries-refused
 * outage, the exact class of misconfiguration self-provisioning exists to
 * remove.
 */
/**
 * Whether an explicitly-set `LWQL_CLICKHOUSE_URL` names a different server than
 * the one self-provisioning derived, which is refused for the same reason
 * `LWQL_DATABASE` is: provisioning creates the access model on the derived
 * server, so querying another would find none of it.
 *
 * Compared by origin rather than by string — the derived URL is normalised
 * (trailing slash, credentials and path stripped) and an operator's value
 * usually is not, so equal servers rarely spell the same. An unparseable value
 * disagrees with everything, which is the safe direction.
 */
function disagreesWithDerivedServer({
  explicitUrl,
  derivedOrigin,
}: {
  explicitUrl: string | undefined;
  derivedOrigin: string;
}): boolean {
  if (!explicitUrl) return false;
  let explicitOrigin: string | null = null;
  try {
    explicitOrigin = new URL(explicitUrl).origin;
  } catch {
    explicitOrigin = null;
  }
  if (explicitOrigin === derivedOrigin) return false;
  logger.error(
    { derivedOrigin },
    "LWQL_SELF_PROVISION cannot target a ClickHouse other than CLICKHOUSE_URL's own: provisioning would create the access model on one server while queries ran against another. Unset LWQL_CLICKHOUSE_URL, or configure the five LWQL_* variables explicitly without LWQL_SELF_PROVISION",
  );
  return true;
}

/**
 * `CLICKHOUSE_URL` reduced to the two things provisioning needs: the server to
 * reach, stripped of its admin credentials and path, and the database that URL
 * names. Every way the value can fail to yield both is refused here, with the
 * reason logged, so the caller carries one "unconfigured" branch instead of
 * six.
 */
function derivedAdminTarget({
  env,
}: {
  env: NodeJS.ProcessEnv;
}): { serverUrl: URL; database: string } | null {
  const adminUrl = env.CLICKHOUSE_URL;
  if (!adminUrl) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but CLICKHOUSE_URL is not set — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    logger.warn(
      "LWQL_SELF_PROVISION is true but CLICKHOUSE_URL is not a parseable URL — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but CLICKHOUSE_URL names no database in its path — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  if (env.LWQL_DATABASE && env.LWQL_DATABASE !== database) {
    logger.error(
      { lwqlDatabase: env.LWQL_DATABASE, adminDatabase: database },
      "LWQL_SELF_PROVISION cannot target a database other than CLICKHOUSE_URL's own: the key-map row policies and the key-map backfill would disagree. Unset LWQL_DATABASE, or configure the five LWQL_* variables explicitly without LWQL_SELF_PROVISION",
    );
    return null;
  }

  // Credentials stripped rather than carried: this URL is handed to a client
  // that authenticates as the restricted identity, and inline admin
  // credentials would win.
  const serverUrl = new URL(adminUrl);
  serverUrl.username = "";
  serverUrl.password = "";
  serverUrl.pathname = "/";
  serverUrl.search = "";
  return { serverUrl, database };
}

export function lwqlDerivedConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LangWatchQLConnection | null {
  if (env.LWQL_SELF_PROVISION !== "true") return null;

  const password = env.LWQL_CLICKHOUSE_PASSWORD;
  if (!password) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but LWQL_CLICKHOUSE_PASSWORD is not set — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }

  const target = derivedAdminTarget({ env });
  if (!target) return null;

  if (
    disagreesWithDerivedServer({
      explicitUrl: env.LWQL_CLICKHOUSE_URL,
      derivedOrigin: target.serverUrl.origin,
    })
  ) {
    return null;
  }

  return {
    url: target.serverUrl.toString(),
    username:
      env.LWQL_CLICKHOUSE_USER ?? LWQL_SELF_PROVISION_DEFAULTS.restrictedUser,
    password,
    database: target.database,
    tenantSetting:
      env.LWQL_TENANT_SETTING ?? LWQL_SELF_PROVISION_DEFAULTS.tenantSetting,
  };
}

/**
 * The full self-provisioning input, for the task. Beyond the connection the
 * task must also converge the PostgreSQL reader role, so its password is
 * required here where it is not for serving.
 */
export function lwqlSelfProvisionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LwqlSelfProvisionEnv | null {
  const connection = lwqlDerivedConnectionFromEnv(env);
  if (!connection) return null;

  const postgresReaderPassword = env.LWQL_POSTGRES_READER_PASSWORD;
  if (!postgresReaderPassword) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but LWQL_POSTGRES_READER_PASSWORD is not set — the access model will not be provisioned this boot",
    );
    return null;
  }

  return { connection, postgresReaderPassword };
}

/** The PostgreSQL endpoint the named collection dials, from `DATABASE_URL`. */
export interface LwqlPostgresEndpoint {
  host: string;
  port: number;
  database: string;
}

/**
 * Where ClickHouse should dial PostgreSQL, read from the app's own
 * `DATABASE_URL`.
 *
 * The address must be reachable *from the ClickHouse server*, not from the
 * app: in the chart both pods sit on the cluster network and the service DNS
 * the app uses resolves identically, which is the deployment this mode ships
 * for. An operator whose ClickHouse cannot reach that address gets a loud
 * engine-table error at provisioning time, not silence.
 */
export function lwqlPostgresEndpointFromDatabaseUrl(
  databaseUrl: string | undefined,
): LwqlPostgresEndpoint | null {
  if (!databaseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!parsed.hostname || !database) return null;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
  };
}

/**
 * Every ClickHouse statement a self-provisioning boot runs, in the order the
 * integration harness proves: access model first (`CREATE USER OR REPLACE`
 * mints a new access-entity id, so everything pointing at the user follows
 * it), then the PostgreSQL bridge, then the views with their grants and row
 * policies.
 *
 * The engine tables are dropped and recreated rather than left to
 * `IF NOT EXISTS`: they are metadata only (no rows live in ClickHouse), and a
 * catalog whose column list changed must converge on upgrade instead of
 * keeping the old shape forever.
 */
export function selfHostedClickHouseProvisioningStatements({
  names,
  restrictedPassword,
  sourceDatabase,
  postgres,
}: {
  names: LangWatchQLNames;
  restrictedPassword: string;
  sourceDatabase: string;
  postgres: {
    endpoint: LwqlPostgresEndpoint;
    readerPassword: string;
  };
}): string[] {
  if (names.database !== sourceDatabase) {
    throw new Error(
      `lwql self-provisioning: the LangWatchQL database ("${names.database}") must be the application's own ClickHouse database ("${sourceDatabase}") — see lwqlDerivedConnectionFromEnv`,
    );
  }
  const collection = LWQL_SELF_PROVISION_DEFAULTS.namedCollection;
  return [
    // Fact tables come from migrations and their grants/policies from
    // lwqlViewSetupStatements below, so the setup list provisions only the
    // identity, the profile, and the key map's grant + policy.
    ...lwqlClickHouseSetupStatements({
      names,
      password: restrictedPassword,
      lwqlTables: [],
    }),
    ...postgresNamedCollectionStatements({
      connection: {
        collection,
        host: postgres.endpoint.host,
        port: postgres.endpoint.port,
        database: postgres.endpoint.database,
        user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
        password: postgres.readerPassword,
      },
    }),
    ...lwqlPostgresViews(LWQL_VIEW_CATALOG).map(
      (view) => `DROP TABLE IF EXISTS ${qualified(names, view.sourceTable)}`,
    ),
    ...lwqlPostgresEngineTableStatements({ names, collection }),
    ...lwqlViewSetupStatements({
      names,
      sourceDatabase,
      dedup: SHIPPED_LWQL_DEDUP,
    }),
  ];
}

/**
 * The PostgreSQL statements converging the reader role the named collection
 * dials with. Run after the approved views exist — the grants name them.
 */
export function selfHostedPostgresReaderStatements({
  schema,
  readerPassword,
}: {
  schema: string;
  readerPassword: string;
}): string[] {
  return postgresReaderRoleStatements({
    reader: {
      role: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
      password: readerPassword,
      schema,
      approvedViews: lwqlApprovedPostgresViewNames(),
      connectionLimit: lwqlPostgresReaderConnectionLimit(),
      statementTimeout: DEFAULT_POSTGRES_READER_LIMITS.statementTimeout,
    },
  });
}
