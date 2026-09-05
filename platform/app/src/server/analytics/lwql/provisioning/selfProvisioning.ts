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
 *    builders (`accessModel.ts`, `postgresMapping.ts`, `catalogStatements.ts`) in the
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

import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import { lwqlPostgresViews } from "../catalog/types";
import {
  type LangWatchQLConnection,
  LWQL_CONNECTION_DEFAULTS,
  lwqlDerivedConnectionFromEnv,
} from "../connection";
import {
  type LangWatchQLNames,
  lwqlClickHouseSetupStatements,
  qualified,
} from "./accessModel";
import {
  lwqlApprovedPostgresViewNames,
  lwqlPostgresEngineTableStatements,
  lwqlPostgresReaderConnectionLimit,
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "./catalogStatements";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  postgresNamedCollectionStatements,
  postgresReaderRoleStatements,
} from "./postgresMapping";
import { LWQL_POSTGRES_READER_ROLE } from "./productionProvisioning";

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
  ...LWQL_CONNECTION_DEFAULTS,
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
