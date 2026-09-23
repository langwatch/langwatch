/**
 * LangWatchQL self-provisioning — the application owns the whole access model
 * on every distribution (issue #8258).
 *
 * The app holds admin credentials for both stores by construction
 * (`CLICKHOUSE_URL`, `DATABASE_URL`), so it does not wait on any out-of-band
 * job to provision the restricted identity, profile, grants, row policies,
 * named collection or reader role: this module turns those admin credentials
 * into a working LangWatchQL deployment on every boot — the two generated
 * passwords in, the `LWQL_*` connection values derived, every access-model
 * object converged idempotently. Where the ClickHouse server instead owns an
 * entity in its own config store, provisioning yields to it and provisions the
 * rest (see `clickhouseStatementRunner.ts`).
 *
 * Two halves, matching the split the rest of the module keeps:
 *
 *  - **Env derivation** ({@link lwqlSelfProvisionFromEnv}) — builds the
 *    restricted connection the executor serves with, from the admin URLs and
 *    the shared default names. Pure over its `env` argument.
 *  - **Statement composition** ({@link selfHostedClickHouseProvisioningStatements},
 *    {@link selfHostedPostgresReaderStatements}) — sequences the reference
 *    builders (`accessModel.ts`, `postgresMapping.ts`, `catalogStatements.ts`) in the
 *    order the integration harness proves works: access model, bridge,
 *    views. Pure; `selfProvisionEntry.ts` is the only caller with I/O.
 *
 * The names are one convention across every distribution, so every operator
 * reading the docs sees the same objects.
 *
 * @see specs/lwql/api.feature
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

/** How this deployment delivers the LangWatchQL access model (#8258). */
export type LwqlAccessModelMode = "rendered" | "sql";

/**
 * How this deployment delivers the LangWatchQL access model (#8258), read in
 * one place so the converge and the server's reconvergence watch agree.
 *
 * `rendered` (the default when unset) ships the access model as per-pod
 * `users.d` / `config.d` config the chart mounts on every replica, so the
 * converge provisions only the structural objects (database, key-map table, app
 * functions, views, postgres-engine tables) and skips every access statement,
 * and the server does not arm the reconvergence watch. `sql` provisions the
 * access model as DDL on the one server behind the service (BYO), the pre-#8258
 * behaviour plus the AC9 cluster guard.
 */
export function lwqlAccessModelMode(
  env: NodeJS.ProcessEnv = process.env,
): LwqlAccessModelMode {
  return env.LWQL_ACCESS_MODEL_MODE === "sql" ? "sql" : "rendered";
}

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
      "LangWatchQL: LWQL_CLICKHOUSE_PASSWORD is set but LWQL_POSTGRES_READER_PASSWORD is not — the access model will not be provisioned this boot",
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
  includeAppFunctions = true,
  includeAccessStatements = true,
}: {
  names: LangWatchQLNames;
  restrictedPassword: string;
  sourceDatabase: string;
  postgres: {
    endpoint: LwqlPostgresEndpoint;
    readerPassword: string;
  };
  /** See {@link canProvisionAppFunctions}. */
  includeAppFunctions?: boolean;
  /**
   * Whether the access statements (the restricted user, the settings profile,
   * every grant, both row policies and the named collection) are emitted as
   * DDL. `false` is the `rendered` mode ({@link lwqlAccessModelMode}): they ship
   * as per-pod `users.d` / `config.d` config, so the converge provisions only
   * the structural objects — the database, the app functions, the key-map
   * table, the postgres-engine tables and the views. Default `true` keeps the
   * `sql` mode output unchanged.
   */
  includeAccessStatements?: boolean;
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
      includeAppFunctions,
      includeAccessStatements,
    }),
    // The named collection is an access statement — in rendered mode it ships as
    // config.d/lwql-named-collection.yaml, so the postgres-engine tables below
    // still reference `lwql_postgres` and find it in the server config.
    ...(includeAccessStatements
      ? postgresNamedCollectionStatements({
          connection: {
            collection,
            host: postgres.endpoint.host,
            port: postgres.endpoint.port,
            database: postgres.endpoint.database,
            user: LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole,
            password: postgres.readerPassword,
          },
        })
      : []),
    ...lwqlPostgresViews(LWQL_VIEW_CATALOG).map(
      (view) => `DROP TABLE IF EXISTS ${qualified(names, view.sourceTable)}`,
    ),
    ...lwqlPostgresEngineTableStatements({ names, collection }),
    ...lwqlViewSetupStatements({
      names,
      sourceDatabase,
      dedup: SHIPPED_LWQL_DEDUP,
      includeAccessStatements,
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

/** What the server says about where a `CREATE FUNCTION` would land. */
export interface AppFunctionStoreProbe {
  /** The widest replica set of any replicated table; 0 on a plain server. */
  readonly maxTotalReplicas: number;
  /** The Keeper path the SQL UDF store is moved to, or empty for local disk. */
  readonly userDefinedZookeeperPath: string;
}

/**
 * Whether the app functions can be created so every replica sees them.
 *
 * A `CREATE FUNCTION` writes the local disk store of the replica that ran it.
 * A single node keeps them there and every query finds them. A server with
 * more than one replica needs `user_defined_zookeeper_path` set, which moves
 * the store into Keeper; without it the create reaches one replica and the
 * others answer UNKNOWN_FUNCTION, so the statements are left out and the gap
 * is logged rather than half provisioned. A layout that could not be read is
 * treated the same way.
 *
 * @see ./appFunctionStatements.ts
 * @see dev/docs/adr/136-lwql-app-functions-identity-udfs.md
 */
export function canProvisionAppFunctions(
  probe: AppFunctionStoreProbe | null,
): boolean {
  if (probe === null) return false;
  return (
    probe.maxTotalReplicas <= 1 || probe.userDefinedZookeeperPath.trim() !== ""
  );
}

/**
 * Reads the two facts {@link canProvisionAppFunctions} decides on.
 *
 * A server that cannot answer (an older release without
 * `system.server_settings`, or an admin without access to `system.replicas`)
 * answers null, and null is not provisionable: a replicated server that could
 * not be recognised as one would otherwise get its functions on one replica.
 */
export async function probeAppFunctionStore({
  query,
}: {
  query: (sql: string) => Promise<Record<string, string>[]>;
}): Promise<AppFunctionStoreProbe | null> {
  try {
    const [replicas, setting] = await Promise.all([
      query(
        "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas",
      ),
      query(
        "SELECT value FROM system.server_settings WHERE name = 'user_defined_zookeeper_path'",
      ),
    ]);
    return {
      maxTotalReplicas: Number(replicas[0]?.max_total_replicas ?? "0") || 0,
      userDefinedZookeeperPath: setting[0]?.value ?? "",
    };
  } catch (error) {
    logger.error(
      { error },
      "lwql self-provisioning could not read the replica layout from system.replicas and system.server_settings; the app functions are left out until it can",
    );
    return null;
  }
}
